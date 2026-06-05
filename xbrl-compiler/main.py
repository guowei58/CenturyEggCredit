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

# Frontend / API ``models`` only: optional extra floor on top of the **first fiscal
# year that has all four quarters** (1Q–4Q) in consolidated data. ``None`` = no
# extra floor (still starts at the first complete fiscal year when one exists).
DISPLAY_MODEL_MIN_FISCAL_YEAR: int | None = 2019
COMPILER_SCHEMA_VERSION = 2


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
    from row_deduplication import apply_row_deduplication
    from statement_universe import universe_keys_not_in_concept_map
    from period_parser import parse_period, sort_period_labels
    from headline_periods import headline_periods_for_workbook

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

    total_facts = sum(len(s.facts) for w in workbooks for s in w.sheets)
    sheets_with_facts = sum(1 for w in workbooks for s in w.sheets if s.facts)
    _log(f"Loaded {len(workbooks)} workbooks, {sheets_with_facts} statement sheets, {total_facts} facts")
    if total_facts == 0:
        return {
            "ok": False,
            "error": (
                "No facts extracted from saved workbooks. Each file needs sheets named "
                "Income Statement / Balance Sheet / Cash Flow with Concept + period columns "
                "(1Q25, FY25, or SEC date headers). Re-run Step 1 bulk save after deploying the latest build."
            ),
            "elapsed_s": round(time.time() - t0, 2),
            "files_processed": len(workbooks),
        }

    # 2 – Pick latest 10-K as master
    _log("Step 2: Identifying master 10-K")
    with_sheets = [w for w in workbooks if w.sheets]
    master_wb = pick_latest_10k(with_sheets) if with_sheets else None
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
    file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in workbooks}
    _log(f"File recency order (oldest→newest): {[w.filename for w in sorted_wbs]}")
    _log(
        "Headline periods (period-primary source): "
        + ", ".join(
            f"{fn}={sorted(list(keys))}" for fn, keys in sorted(file_headline_periods.items())
        )
    )

    # 5 – Consolidate (period-primary filing wins when tagged; else most-recent file)
    _log("Step 5: Consolidating across files")
    consolidated, audit_entries, conflicts = consolidate(
        mapped, master_rows, file_recency, file_headline_periods,
    )
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

    _log("Step 6c: Row deduplication (merge duplicate canonical rows)")
    dedup_res = apply_row_deduplication(
        consolidated, master_rows, concept_map, audit_entries,
    )
    derived_audit_3: list = []
    if dedup_res.changed:
        derived_audit_3 = derive_quarters(consolidated, master_rows, audit_entries)
        _log(f"Row deduplication: removed {dedup_res.rows_removed} duplicate canonical rows; re-derived {len(derived_audit_3)} values")
        unresolved = _prune_unresolved_after_map(unresolved, concept_map)
    else:
        _log("Row deduplication: no duplicate canonical rows merged")

    all_audit = audit_entries + derived_audit + derived_audit_2 + derived_audit_3

    # 7 – Validate
    _log("Step 7: Validating")
    validations, cell_failures = validate_all(consolidated, master_rows)

    # 8 – Export
    _log("Step 8: Exporting")
    exp = export_all(consolidated, master_rows, concept_map, all_audit,
                     conflicts, unresolved, log_msgs, output_dir)

    elapsed = round(time.time() - t0, 2)

    from period_parser import parse_period
    from xbrl_periods import xbrl_backed_period_canonicals_by_statement

    xbrl_by_stmt: dict[str, set[str]] = {
        st: set(keys) for st, keys in xbrl_backed_period_canonicals_by_statement(workbooks).items()
    }
    _DERIVED_METHODS = frozenset({
        "derived",
        "copied_from_fy_for_wacs",
        "copied_from_fy_for_bs",
        "summed_within_file",
    })
    for ae in all_audit:
        if ae.source_method not in _DERIVED_METHODS:
            continue
        st = ae.statement_type
        p = parse_period(ae.output_period)
        if not p or p.fiscal_year < (DISPLAY_MODEL_MIN_FISCAL_YEAR or 0):
            continue
        stmt_years = {
            parse_period(pl).fiscal_year
            for pl in xbrl_by_stmt.get(st, ())
            if parse_period(pl) is not None
        }
        if stmt_years and p.fiscal_year in stmt_years:
            xbrl_by_stmt.setdefault(st, set()).add(ae.output_period)
    xbrl_by_stmt_frozen = {st: frozenset(keys) for st, keys in xbrl_by_stmt.items()}
    _log(
        f"XBRL-backed display periods by statement (FY>={DISPLAY_MODEL_MIN_FISCAL_YEAR}): "
        + ", ".join(f"{st}={len(keys)}" for st, keys in sorted(xbrl_by_stmt_frozen.items()))
    )

    # Build frontend models (include cell failures for red highlighting)
    models, display_starts = _models_json(
        consolidated,
        master_rows,
        cell_failures,
        allowed_periods_by_statement=xbrl_by_stmt_frozen,
    )
    for st, yr in sorted(display_starts.items()):
        _log(f"Display column start: {st} fiscal year {yr}")

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
        "compiler_schema_version": COMPILER_SCHEMA_VERSION,
        "display_models_min_fiscal_year": DISPLAY_MODEL_MIN_FISCAL_YEAR,
        "xbrl_backed_period_count": sum(len(v) for v in xbrl_by_stmt_frozen.values()),
        "xbrl_backed_periods_by_statement": {st: sorted(v) for st, v in xbrl_by_stmt_frozen.items()},
        "display_column_start_fiscal_year": display_starts,
        "elapsed_s": elapsed,
        "master_file": master_wb.filename,
        "files_processed": len(workbooks),
        "sheets_processed": sum(len(w.sheets) for w in workbooks),
        "total_facts": total_facts,
        "total_concepts": len(master_rows),
        "mapped_facts": len(mapped),
        "statements_built": list(consolidated.keys()),
        "derived_facts": len(derived_audit) + len(derived_audit_2) + len(derived_audit_3),
        "row_deduplication": {
            "changed": dedup_res.changed,
            "rows_removed": dedup_res.rows_removed,
            "detail": dedup_res.detail,
        },
        "universe_gaps_after_build": universe_keys_not_in_concept_map(workbooks, concept_map),
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

    if DISPLAY_MODEL_MIN_FISCAL_YEAR is None:
        _log(
            "Display models: quarterly/annual columns start at the first fiscal year "
            "with all four quarters (unless no such year exists); full history in export files"
        )
    else:
        _log(
            f"Display models: columns start at max(first complete FY, {DISPLAY_MODEL_MIN_FISCAL_YEAR}); "
            "full history remains in consolidated output files"
        )
    _log(f"Pipeline complete in {elapsed}s")
    return summary


def _cell_for_period(vals: dict, lbl: str) -> float | None:
    """Lookup a cell; match by canonical period when keys use prose vs FY24."""
    from period_parser import parse_period

    if lbl in vals:
        return vals.get(lbl)
    p = parse_period(lbl)
    if p is None:
        return None
    for k, v in vals.items():
        if k.startswith("_"):
            continue
        pk = parse_period(k)
        if pk and pk.canonical == p.canonical:
            return v
    return None


def _collect_fy_column_labels(
    concepts: dict,
    display_floor: int | None,
    allowed: frozenset[str] | None,
) -> list[str]:
    """Canonical FY column keys (FY24) present in consolidated balance-sheet data."""
    from period_parser import parse_period, sort_period_labels

    canon_keys: set[str] = set()
    for vals in concepts.values():
        for lbl in vals:
            if lbl.startswith("_"):
                continue
            p = parse_period(lbl)
            if not p or not p.is_annual():
                continue
            if display_floor is not None and p.fiscal_year < display_floor:
                continue
            if allowed is not None and p.canonical not in allowed:
                yy = str(p.fiscal_year % 100).zfill(2)
                if not any(f"{qi}Q{yy}" in allowed for qi in "1234"):
                    continue
            canon_keys.add(p.canonical)
    return sort_period_labels(list(canon_keys))


def _balance_sheet_cell(vals: dict, period_lbl: str) -> float | None:
    """BS year-end FY often equals 4Q; derivation may only populate 4Q."""
    from period_parser import parse_period

    v = _cell_for_period(vals, period_lbl)
    if v is not None:
        return v
    p = parse_period(period_lbl)
    if p and p.is_annual():
        yy = str(p.fiscal_year % 100).zfill(2)
        return _cell_for_period(vals, f"4Q{yy}")
    return None


def _models_json(
    data: dict,
    master_rows: list,
    cell_failures: dict[tuple[str, str, str], list[str]] | None = None,
    *,
    display_min_fiscal_year: int | None = None,
    allowed_periods: frozenset[str] | None = None,
    allowed_periods_by_statement: dict[str, frozenset[str]] | None = None,
) -> tuple[dict, dict[str, int]]:
    from period_parser import (
        ensure_quarter_and_fy_columns,
        interleave_annual_after_q4,
        parse_period,
        sort_period_labels,
    )

    def _period_allowed(lbl: str, st: str) -> bool:
        p = parse_period(lbl)
        if p is None:
            return False
        if allowed_periods_by_statement is not None:
            allowed = allowed_periods_by_statement.get(st)
            if allowed is not None:
                if p.canonical in allowed:
                    return True
                # Keep FY / 4Q when any quarter of that year is tagged (derived or filed)
                if p.is_annual() or (p.is_quarterly() and p.period_type == "Q4"):
                    yy = str(p.fiscal_year % 100).zfill(2)
                    return any(f"{qi}Q{yy}" in allowed for qi in "1234")
        if allowed_periods is None:
            return True
        if p.canonical in allowed_periods:
            return True
        if p.is_annual() or (p.is_quarterly() and p.period_type == "Q4"):
            yy = str(p.fiscal_year % 100).zfill(2)
            return any(f"{qi}Q{yy}" in allowed_periods for qi in "1234")
        return False

    floor_eff = (
        display_min_fiscal_year
        if display_min_fiscal_year is not None
        else DISPLAY_MODEL_MIN_FISCAL_YEAR
    )

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
    display_starts: dict[str, int] = {}
    for st in stmt_keys:
        concepts = data.get(st, {})
        q_set: set[str] = set()
        a_set: set[str] = set()
        cum_fiscal_years: set[int] = set()
        for vals in concepts.values():
            for lbl in vals:
                p = parse_period(lbl)
                if p and (p.is_quarterly() or p.is_annual()):
                    q_set.add(lbl)
                if p and p.is_annual():
                    a_set.add(lbl)
                if p and p.is_cumulative():
                    cum_fiscal_years.add(p.fiscal_year)

        def _seed_ytd_only_years(period_list: list[str]) -> list[str]:
            """6M/9M facts are not display columns; seed years so 1Q–4Q/FY slots still appear."""
            if not cum_fiscal_years:
                return period_list
            out = list(period_list)
            present = set(out)
            for yr in sorted(cum_fiscal_years):
                seed = f"1Q{str(yr % 100).zfill(2)}"
                if seed not in present:
                    out.append(seed)
                    present.add(seed)
            return sort_period_labels(out)

        qs_all = sort_period_labels(list(q_set))
        ays_all = sort_period_labels(list(a_set))

        # Display columns: start at the earliest fiscal year that has Q1–Q4 (any line
        # with data). Align annual columns to the same floor. If no year has all
        # four quarters, show all periods (same as before). Optional ``floor_eff``
        # raises the start year when set.
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

        # When a minimum display year is configured (2019 for inline XBRL era), show
        # every tagged period from that year — do not wait for the first fiscal year
        # with all four quarters (GEN IS/CF often lack a complete early year until ~FY24).
        if floor_eff is not None:
            display_floor = floor_eff
        else:
            display_floor = first_complete_year

        if display_floor is None:
            qs = qs_all
            ays = ays_all
        else:
            display_starts[st] = display_floor
            qs = [
                lbl for lbl in qs_all
                if (p := parse_period(lbl)) is not None and p.fiscal_year >= display_floor
            ]
            ays = [
                lbl for lbl in ays_all
                if (p := parse_period(lbl)) is not None and p.fiscal_year >= display_floor
            ]

        if allowed_periods is not None or allowed_periods_by_statement is not None:
            qs = [lbl for lbl in qs if _period_allowed(lbl, st)]
            ays = [lbl for lbl in ays if _period_allowed(lbl, st)]

        if st == "balance_sheet":
            allowed_bs = (
                allowed_periods_by_statement.get(st)
                if allowed_periods_by_statement is not None
                else allowed_periods
            )
            fy_cols = _collect_fy_column_labels(concepts, display_floor, allowed_bs)
            qs_quarters = [
                lbl
                for lbl in qs
                if (p := parse_period(lbl)) is not None and p.is_quarterly()
            ]
            qs = interleave_annual_after_q4(qs_quarters, fy_cols)
            qs = ensure_quarter_and_fy_columns(_seed_ytd_only_years(qs))
        else:
            qs = ensure_quarter_and_fy_columns(_seed_ytd_only_years(qs))

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
                if st == "balance_sheet":
                    q[p] = _balance_sheet_cell(vals, p)
                else:
                    q[p] = _cell_for_period(vals, p)
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
    return models, display_starts


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

    # Single-line JSON so the Node API can JSON.parse(stdout) reliably (pretty-print breaks naive brace scanners).
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
