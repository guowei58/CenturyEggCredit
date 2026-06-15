"""Trace DisposalGroup CF line from saved LUMN FY22 10-K workbook through compiler steps."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "xbrl-compiler"))

CANON = "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal"
LABEL = "Loss on disposal groups held for sale"


def build_fy22_workbook_xlsx(out: Path) -> None:
    """Build FY22 10-K xlsx via Node (same as bulk save)."""
    import subprocess

    script = ROOT / "scripts" / "_build_lumn_fy22_wb_only.ts"
    subprocess.run(
        ["npx", "tsx", str(script), str(out)],
        cwd=ROOT,
        check=True,
        timeout=120_000,
    )


def main() -> None:
    from workbook_loader import load_all_workbooks, pick_latest_10k
    from master_presentation_builder import build_master_presentation
    from row_mapper import map_all_facts
    from headline_periods import headline_periods_for_workbook
    from consolidator import consolidate
    from coverage_pass import apply_coverage_pass
    from derivation_engine import derive_quarters
    from coverage_pass import reconcile_final_statements_with_raw_xbrl
    from row_deduplication import apply_row_deduplication
    from workbook_truth import (
        run_workbook_truth_until_clean,
        build_workbook_truth_index,
        collect_workbook_canonical_concepts,
    )
    from main import _models_json
    from xbrl_periods import xbrl_backed_period_canonicals_by_statement

    wb_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "in"
        out = Path(td) / "out"
        inp.mkdir()
        out.mkdir()

        if wb_path and wb_path.exists():
            import shutil
            shutil.copy(wb_path, inp / wb_path.name)
        else:
            build_fy22_workbook_xlsx(inp / "LUMN_FY22_10K.xlsx")

        workbooks = load_all_workbooks(inp)
        print(f"Loaded {len(workbooks)} workbook(s)")
        for wb in workbooks:
            print(f"  {wb.filename} is_10k={wb.is_10k} latest_fy={wb.latest_fy}")
            for sh in wb.sheets:
                if sh.statement_type != "cash_flow":
                    continue
                hits = [
                    f for f in sh.facts
                    if CANON in f.concept or LABEL.lower() in (f.line_label or "").lower()
                ]
                print(f"  CF facts matching disposal: {len(hits)}")
                for f in hits:
                    print(
                        f"    concept={f.concept!r} period={f.period.canonical} "
                        f"value={f.value} col={f.source_column!r} file={f.source_file}"
                    )

        master_wb = pick_latest_10k(workbooks)
        assert master_wb
        master_rows, concept_map = build_master_presentation(master_wb, all_workbooks=workbooks)
        mapped, unresolved = map_all_facts(workbooks, concept_map, master_rows)
        mapped_hits = [m for m in mapped if m.canonical_row_id == CANON and m.statement_type == "cash_flow"]
        print(f"\nMapped CF disposal facts: {len(mapped_hits)}")
        for m in mapped_hits:
            print(f"  period={m.period.canonical} value={m.value} file={m.source_file} raw={m.raw_concept}")

        sorted_wbs = sorted(workbooks, key=lambda w: (w.latest_fy, w.filename))
        file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
        file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in workbooks}
        print(f"\nHeadline periods: { {k: sorted(v) for k,v in file_headline_periods.items()} }")

        consolidated, audit, conflicts = consolidate(
            mapped, master_rows, file_recency, file_headline_periods,
        )
        cf_cell = consolidated.get("cash_flow", {}).get(CANON, {})
        print(f"\nAfter consolidate CF[{CANON}]: {cf_cell}")

        _, _ = apply_coverage_pass(
            workbooks, master_rows, concept_map, consolidated, file_recency,
            mapped, unresolved, audit, file_headline_periods,
        )
        print(f"After coverage: {consolidated.get('cash_flow', {}).get(CANON, {})}")

        derive_quarters(consolidated, master_rows, audit)
        print(f"After derive: {consolidated.get('cash_flow', {}).get(CANON, {})}")

        reconcile_final_statements_with_raw_xbrl(
            workbooks, master_rows, concept_map, consolidated, file_recency, audit, file_headline_periods,
        )
        print(f"After reconcile: {consolidated.get('cash_flow', {}).get(CANON, {})}")

        apply_row_deduplication(consolidated, master_rows, concept_map, audit)
        print(f"After dedup: {consolidated.get('cash_flow', {}).get(CANON, {})}")

        derived_audit: list = []
        run_workbook_truth_until_clean(
            consolidated, workbooks, concept_map, master_rows, file_headline_periods,
            audit, derived_audit, derive_quarters,
        )
        print(f"After workbook_truth: {consolidated.get('cash_flow', {}).get(CANON, {})}")

        truth = build_workbook_truth_index(workbooks, concept_map, master_rows, file_headline_periods)
        truth_hits = {k: v for k, v in truth.items() if k[1] == CANON}
        print(f"\nTruth index for disposal: {truth_hits}")

        xbrl_by_stmt = {st: set(keys) for st, keys in xbrl_backed_period_canonicals_by_statement(workbooks).items()}
        wb_canons = {st: frozenset(c) for st, c in collect_workbook_canonical_concepts(workbooks, concept_map).items()}
        models, _ = _models_json(
            consolidated, master_rows, None,
            allowed_periods_by_statement={st: frozenset(k) for st, k in xbrl_by_stmt.items()},
            workbook_canons_by_statement=wb_canons,
        )
        qrows = models["cash_flow"]["quarterly"]["rows"]
        qrow = next((r for r in qrows if r.get("concept") == CANON), None)
        print(f"\nModel quarterly row: {json.dumps(qrow, default=str)}")
        print(f"FY22 in periods: {'FY22' in models['cash_flow']['quarterly']['periods']}")


if __name__ == "__main__":
    main()
