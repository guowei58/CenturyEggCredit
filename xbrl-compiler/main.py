"""CLI entry point for the deterministic XBRL statement compiler.

Usage:
    python main.py --input "path/to/folder" --output "path/to/output"
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("xbrl_compiler")

# Frontend / API ``models`` only: full pipeline still loads all years; statements
# shown in the app (and compile-tab Excel download) omit periods before this FY.
DISPLAY_MODEL_MIN_FISCAL_YEAR = 2017


def run(
    input_dir: str,
    output_dir: str,
    ai_provider: str | None = None,
    ai_api_key: str | None = None,
    ai_model: str | None = None,
) -> dict:
    """Execute the full pipeline.  Returns a JSON-serialisable summary."""
    from workbook_loader import load_all_workbooks, pick_latest_10k
    from master_presentation_builder import build_master_presentation
    from row_mapper import map_all_facts
    from consolidator import consolidate
    from derivation_engine import derive_quarters
    from validators import validate_all
    from exporter import export_all
    from coverage_pass import (
        apply_coverage_pass,
        reconcile_final_statements_with_raw_xbrl,
        _prune_unresolved_after_map,
    )
    from period_parser import parse_period, sort_period_labels

    t0 = time.time()
    log_msgs: list[str] = []

    def _log(msg: str) -> None:
        log_msgs.append(msg)
        logger.info(msg)

    _log(f"Pipeline start  input={input_dir}  output={output_dir}")

    # 1 – Load workbooks
    _log("Step 1: Loading workbooks")
    workbooks = load_all_workbooks(input_dir)
    if not workbooks:
        return {"ok": False, "error": f"No workbooks found in {input_dir}",
                "elapsed_s": round(time.time() - t0, 2)}

    total_facts = sum(len(f) for w in workbooks for s in w.sheets for f in [s.facts])
    _log(f"Loaded {len(workbooks)} workbooks, {total_facts} facts")

    # 2 – Pick latest 10-K as master
    _log("Step 2: Identifying master 10-K")
    master_wb = pick_latest_10k(workbooks)
    if master_wb is None:
        return {"ok": False, "error": "No workbook with statement sheets found",
                "elapsed_s": round(time.time() - t0, 2)}
    _log(f"Master workbook: {master_wb.filename}  (is_10k={master_wb.is_10k}, latest_fy={master_wb.latest_fy})")

    # 3 – Build master presentation + concept map (scan ALL files, AI Phase 3)
    _log("Step 3: Building master presentation")
    if ai_provider:
        _log(f"  AI matching enabled: provider={ai_provider}  model={ai_model or 'default'}")
    master_rows, concept_map = build_master_presentation(
        master_wb,
        all_workbooks=workbooks,
        ai_provider=ai_provider,
        ai_api_key=ai_api_key,
        ai_model=ai_model,
    )
    from interest_netting import apply_interest_netting_aliases

    interest_net_aliases = apply_interest_netting_aliases(
        master_rows, concept_map, workbooks,
    )
    ai_matched = sum(1 for m in concept_map if m.mapping_status == "ai_matched")
    _log(
        f"Master rows: {len(master_rows)}, concept mappings: {len(concept_map)}, "
        f"AI matches: {ai_matched}, interest netting aliases: {interest_net_aliases}",
    )

    # 4 – Map all facts
    _log("Step 4: Mapping facts to canonical rows")
    mapped, unresolved = map_all_facts(workbooks, concept_map, master_rows)
    _log(f"Mapped: {len(mapped)}, unresolved: {len(unresolved)}")

    # 4b – Build file recency ranking (higher = more recent filing)
    sorted_wbs = sorted(workbooks, key=lambda w: (w.latest_fy, w.filename))
    file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
    _log(f"File recency order (oldest→newest): {[w.filename for w in sorted_wbs]}")

    # 5 – Consolidate (most-recent file wins when duplicates exist)
    _log("Step 5: Consolidating across files")
    consolidated, audit_entries, conflicts = consolidate(mapped, master_rows, file_recency)
    _log(f"Consolidated cells: {sum(len(v) for cc in consolidated.values() for v in cc.values())}, conflicts: {len(conflicts)}")

    # 5b – Coverage pass (repair mapped gaps; integrate unresolved with positional rows)
    _log("Step 5b: Coverage pass")
    unresolved, coverage_stats = apply_coverage_pass(
        workbooks,
        master_rows,
        concept_map,
        consolidated,
        file_recency,
        mapped,
        unresolved,
        audit_entries,
    )
    cov_msg = (
        f"Coverage: repaired {coverage_stats.repaired_mapped_cells} mapped cells; "
        f"row_order registry +{getattr(coverage_stats, 'row_order_registry_rows', 0)} rows; "
        f"explicit workbook +{coverage_stats.explicit_workbook_rows} rows / "
        f"+{coverage_stats.explicit_workbook_cells} cells; "
        f"workbook gap fills {coverage_stats.workbook_fact_gap_fills}; "
        f"integrated {coverage_stats.integrated_unresolved_rows} unresolved rows, "
        f"{coverage_stats.integrated_unresolved_cells} cells; "
        f"unresolved remaining {len(unresolved)}"
    )
    _log(cov_msg)

    # 6 – Derive missing quarters
    _log("Step 6: Deriving missing quarters")
    derived_audit = derive_quarters(consolidated, master_rows, audit_entries)
    _log(f"Derived {len(derived_audit)} quarterly values")

    # 6b – Final reconcile: every raw XBRL line item vs built statements
    _log("Step 6b: Final raw XBRL reconcile (add any missing lines / cells)")
    final_reconcile = reconcile_final_statements_with_raw_xbrl(
        workbooks, master_rows, concept_map, consolidated, file_recency, audit_entries,
    )
    _log(
        f"Final reconcile: scanned {final_reconcile.raw_keys_scanned} raw keys; "
        f"+{final_reconcile.rows_added} rows, +{final_reconcile.maps_repaired} map repairs, "
        f"+{final_reconcile.orphan_master_rows_recovered} orphan master rows, "
        f"+{final_reconcile.cells_added} cells"
    )
    derived_audit_2 = []
    if final_reconcile.changed:
        derived_audit_2 = derive_quarters(consolidated, master_rows, audit_entries)
        _log(f"Re-derived after reconcile: {len(derived_audit_2)} quarterly values")
        unresolved = _prune_unresolved_after_map(unresolved, concept_map)

    all_audit = audit_entries + derived_audit + derived_audit_2

    # 7 – Validate
    _log("Step 7: Validating")
    validations, cell_failures = validate_all(consolidated, master_rows)

    # 8 – Export
    _log("Step 8: Exporting")
    exp = export_all(consolidated, master_rows, concept_map, all_audit,
                     conflicts, unresolved, log_msgs, output_dir)

    elapsed = round(time.time() - t0, 2)

    # Build frontend models (include cell failures for red highlighting)
    models = _models_json(consolidated, master_rows, cell_failures)

    # Build concept-map diagnostics grouped by statement
    concept_map_summary: list[dict] = []
    for cm in concept_map:
        concept_map_summary.append({
            "stmt": cm.statement_type,
            "raw": cm.raw_concept,
            "canon": cm.canonical_row_id,
            "status": cm.mapping_status,
            "notes": cm.notes,
        })

    # Per-file concept inventory for balance sheet (for diagnostics)
    bs_file_concepts: dict[str, list[str]] = {}
    for wb in workbooks:
        for sh in wb.sheets:
            if sh.statement_type == "balance_sheet":
                bs_file_concepts[wb.filename] = list(sh.row_order)

    summary = {
        "ok": True,
        "display_models_min_fiscal_year": DISPLAY_MODEL_MIN_FISCAL_YEAR,
        "elapsed_s": elapsed,
        "master_file": master_wb.filename,
        "files_processed": len(workbooks),
        "sheets_processed": sum(len(w.sheets) for w in workbooks),
        "total_facts": total_facts,
        "total_concepts": len(master_rows),
        "mapped_facts": len(mapped),
        "statements_built": list(consolidated.keys()),
        "derived_facts": len(derived_audit) + len(derived_audit_2),
        "final_raw_reconcile": {
            "raw_keys_scanned": final_reconcile.raw_keys_scanned,
            "rows_added": final_reconcile.rows_added,
            "maps_repaired": final_reconcile.maps_repaired,
            "orphan_master_rows_recovered": final_reconcile.orphan_master_rows_recovered,
            "cells_added": final_reconcile.cells_added,
        },
        "conflicts_count": len(conflicts),
        "unresolved_count": len(unresolved),
        "coverage_pass": {
            "repaired_mapped_cells": coverage_stats.repaired_mapped_cells,
            "row_order_registry_rows": getattr(coverage_stats, "row_order_registry_rows", 0),
            "integrated_unresolved_rows": coverage_stats.integrated_unresolved_rows,
            "integrated_unresolved_cells": coverage_stats.integrated_unresolved_cells,
            "explicit_workbook_rows": coverage_stats.explicit_workbook_rows,
            "explicit_workbook_cells": coverage_stats.explicit_workbook_cells,
            "workbook_fact_gap_fills": coverage_stats.workbook_fact_gap_fills,
        },
        "validation_passed": sum(v.passed for v in validations),
        "validation_failed": sum(not v.passed for v in validations),
        "output_files": exp.get("files", []),
        "models": models,
        "concept_map_summary": concept_map_summary,
        "bs_file_concepts": bs_file_concepts,
        "conflicts_detail": [
            {"statement_type": c.statement_type, "canonical_row_id": c.canonical_row_id,
             "period": c.period,
             "values": [{"value": v, "source_file": sf, "source_sheet": ss,
                         "source_column": sc, "raw_concept": rc}
                        for v, sf, ss, sc, rc in c.values],
             "resolution": c.resolution}
            for c in conflicts
        ],
        "unresolved_detail": [
            {"source_file": u.source_file, "source_sheet": u.source_sheet,
             "statement_type": u.statement_type,
             "line_label": u.line_label, "concept": u.concept,
             "period_label": u.period_label, "reason": u.reason}
            for u in unresolved
        ],
        "validation_detail": [
            {"check": v.check, "passed": v.passed, "statement_type": v.statement_type,
             "canonical_row_id": v.canonical_row_id, "period": v.period, "detail": v.detail}
            for v in validations if not v.passed
        ],
    }

    _log(
        f"Display models: periods restricted to fiscal year >= {DISPLAY_MODEL_MIN_FISCAL_YEAR} "
        "(full history remains in consolidated output files)"
    )
    _log(f"Pipeline complete in {elapsed}s")
    return summary


def _models_json(
    data: dict,
    master_rows: list,
    cell_failures: dict[tuple[str, str, str], list[str]] | None = None,
    *,
    display_min_fiscal_year: int | None = None,
) -> dict:
    from period_parser import parse_period, sort_period_labels

    floor = display_min_fiscal_year if display_min_fiscal_year is not None else DISPLAY_MODEL_MIN_FISCAL_YEAR

    failures = cell_failures or {}

    labels = {(r.statement_type, r.canonical_row_id): r.display_label for r in master_rows}
    orders: dict[str, list[str]] = {}
    seen_row: dict[str, set[str]] = {}
    for r in sorted(master_rows, key=lambda r: r.display_order):
        st = r.statement_type
        cid = r.canonical_row_id
        seen_row.setdefault(st, set())
        if cid in seen_row[st]:
            continue
        seen_row[st].add(cid)
        orders.setdefault(st, []).append(cid)

    # Include every statement that has master rows OR consolidated data (either
    # can be missing the other in edge cases).
    stmt_keys: list[str] = []
    for s in ("income_statement", "balance_sheet", "cash_flow"):
        if s in orders or s in data:
            stmt_keys.append(s)
    for s in sorted(set(orders.keys()) | set(data.keys())):
        if s not in stmt_keys:
            stmt_keys.append(s)

    models: dict = {}
    for st in stmt_keys:
        concepts = data.get(st, {})
        q_set: set[str] = set()
        a_set: set[str] = set()
        for vals in concepts.values():
            for lbl in vals:
                p = parse_period(lbl)
                if p and (p.is_quarterly() or p.is_annual()):
                    q_set.add(lbl)
                if p and p.is_annual():
                    a_set.add(lbl)

        qs_all = sort_period_labels(list(q_set))
        ays = sort_period_labels(list(a_set))

        # Trim quarterly periods: start from the earliest year that has
        # all 4 quarters (1Q, 2Q, 3Q, 4Q) with at least *some* data.
        year_qtrs: dict[int, set[str]] = {}
        for lbl in qs_all:
            p = parse_period(lbl)
            if p and p.is_quarterly():
                year_qtrs.setdefault(p.fiscal_year, set()).add(p.period_type)

        first_complete_year: int | None = None
        for yr in sorted(year_qtrs):
            if {"Q1", "Q2", "Q3", "Q4"}.issubset(year_qtrs[yr]):
                first_complete_year = yr
                break

        # Quarterly-style grid: respect both (a) earliest year with four quarters
        # and (b) display floor — never show periods before *floor*.
        if first_complete_year is not None:
            min_q_yr = max(first_complete_year, floor)
            qs = [
                lbl for lbl in qs_all
                if (p := parse_period(lbl)) is not None
                and p.fiscal_year >= min_q_yr
            ]
        else:
            qs = [
                lbl for lbl in qs_all
                if (p := parse_period(lbl)) is not None
                and p.fiscal_year >= floor
            ]

        ays = [
            lbl for lbl in ays
            if (p := parse_period(lbl)) is not None
            and p.fiscal_year >= floor
        ]

        seen: set[str] = set()
        ordered: list[str] = []
        # Include every master row even when consolidated has no key for that
        # canonical id (otherwise BS lines like intangibles vanish from the UI).
        for crid in orders.get(st, []):
            if crid not in seen:
                ordered.append(crid)
                seen.add(crid)
        for crid in sorted(concepts):
            if crid not in seen:
                ordered.append(crid)
                seen.add(crid)

        qr, ar = [], []
        # Build a set of failed cells: "concept::period" for quick lookup
        fail_set: set[str] = set()
        for (fst, fcrid, fperiod) in failures:
            if fst == st:
                fail_set.add(f"{fcrid}::{fperiod}")

        for crid in ordered:
            vals = concepts.get(crid, {})
            disp = labels.get((st, crid), crid)
            q: dict = {"concept": crid, "line": disp}
            a: dict = {"concept": crid, "line": disp}
            q_fails: list[str] = []
            a_fails: list[str] = []
            for p in qs:
                q[p] = vals.get(p)
                if f"{crid}::{p}" in fail_set:
                    q_fails.append(p)
            for p in ays:
                a[p] = vals.get(p)
                if f"{crid}::{p}" in fail_set:
                    a_fails.append(p)
            if q_fails:
                q["_fails"] = q_fails
            if a_fails:
                a["_fails"] = a_fails
            qr.append(q)
            ar.append(a)

        models[st] = {
            "quarterly": {"periods": qs, "rows": qr},
            "annual": {"periods": ays, "rows": ar},
        }
    return models


def main() -> None:
    parser = argparse.ArgumentParser(description="Deterministic XBRL Statement Compiler")
    parser.add_argument("--input", required=True, help="Folder with Excel workbooks")
    parser.add_argument("--output", required=True, help="Output directory")
    parser.add_argument("--ai-provider", default=None,
                        help="AI provider for concept matching: openai | deepseek (omit to disable)")
    parser.add_argument("--ai-api-key", default=None,
                        help="API key (falls back to OPENAI_API_KEY / DEEPSEEK_API_KEY env)")
    parser.add_argument("--ai-model", default=None,
                        help="Override model name for AI matching")
    args = parser.parse_args()

    result = run(
        args.input, args.output,
        ai_provider=args.ai_provider,
        ai_api_key=args.ai_api_key,
        ai_model=args.ai_model,
    )
    if not result.get("ok"):
        logger.error("Pipeline failed: %s", result.get("error"))
        sys.exit(1)

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
