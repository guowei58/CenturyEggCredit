"""Step trace when FY22 10-K is OMITTED — shows which step breaks FY22=700."""
from __future__ import annotations

import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "xbrl-compiler"))

CANON = "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal"
FY22 = "FY22"


def step(name: str, ok: bool, detail: str) -> None:
    print(f"\n[{'PASS' if ok else 'FAIL'}] {name}\n       {detail}")


def main() -> None:
    from workbook_loader import load_all_workbooks, pick_latest_10k
    from master_presentation_builder import build_master_presentation
    from row_mapper import map_all_facts
    from headline_periods import headline_periods_for_workbook
    from consolidator import consolidate
    from coverage_pass import apply_coverage_pass, reconcile_final_statements_with_raw_xbrl
    from derivation_engine import derive_quarters
    from row_deduplication import apply_row_deduplication
    from workbook_truth import run_workbook_truth_until_clean, build_workbook_truth_index
    from main import _models_json
    from xbrl_periods import xbrl_backed_period_canonicals_by_statement
    from workbook_truth import collect_workbook_canonical_concepts

    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "in"
        inp.mkdir()
        mat = ROOT / "scripts" / "_materialize_lumn_for_trace.ts"
        subprocess.run(
            f'npx tsx "{mat}" "{inp}"',
            cwd=ROOT,
            check=True,
            timeout=900_000,
            shell=True,
        )
        # Remove FY22 headline owner (Feb 2023 10-K)
        removed = []
        for f in list(inp.glob("*10-K_2023-02*.xlsx")):
            removed.append(f.name)
            f.unlink()
        print("=== SCENARIO: FY22 10-K REMOVED ===")
        print("removed:", removed or "(none found)")

        workbooks = load_all_workbooks(inp)
        loader_fy22_700 = []
        for wb in workbooks:
            for sh in wb.sheets:
                if sh.statement_type != "cash_flow":
                    continue
                for f in sh.facts:
                    if CANON in (f.concept or "") and f.period.canonical == FY22:
                        loader_fy22_700.append((wb.filename, f.value))

        step("1 LOAD", len(loader_fy22_700) > 0,
             f"FY22 disposal facts from remaining files: {loader_fy22_700[:8]}")

        master_wb = pick_latest_10k(workbooks)
        master_rows, concept_map = build_master_presentation(master_wb, all_workbooks=workbooks)
        mapped, unresolved = map_all_facts(workbooks, concept_map, master_rows)
        mapped_fy22 = [m for m in mapped if m.canonical_row_id == CANON and m.period.canonical == FY22]
        step("2 MAP", len(mapped_fy22) > 0,
             f"mapped FY22 disposal: {[(m.value, m.source_file) for m in mapped_fy22]}")

        sorted_wbs = sorted(workbooks, key=lambda w: (w.latest_fy, w.filename))
        file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
        file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in workbooks}
        fy22_owner = [fn for fn, ps in file_headline_periods.items() if FY22 in ps]
        step("3 HEADLINE", len(fy22_owner) > 0, f"files owning FY22 headline: {fy22_owner}")

        consolidated, audit, _ = consolidate(mapped, master_rows, file_recency, file_headline_periods)
        fy22 = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("4 CONSOLIDATE", fy22 is not None, f"FY22={fy22}")

        apply_coverage_pass(workbooks, master_rows, concept_map, consolidated, file_recency,
                            mapped, unresolved, audit, file_headline_periods)
        step("5 COVERAGE", consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22) is not None,
             f"FY22={consolidated.get('cash_flow', {}).get(CANON, {}).get(FY22)}")

        derive_quarters(consolidated, master_rows, audit)
        step("6 DERIVE", consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22) is not None,
             f"FY22={consolidated.get('cash_flow', {}).get(CANON, {}).get(FY22)}")

        reconcile_final_statements_with_raw_xbrl(
            workbooks, master_rows, concept_map, consolidated, file_recency, audit, file_headline_periods)
        step("7 RECONCILE", consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22) is not None,
             f"FY22={consolidated.get('cash_flow', {}).get(CANON, {}).get(FY22)}")

        apply_row_deduplication(consolidated, master_rows, concept_map, audit)
        step("8 DEDUP", consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22) is not None,
             f"FY22={consolidated.get('cash_flow', {}).get(CANON, {}).get(FY22)}")

        derived_audit: list = []
        run_workbook_truth_until_clean(
            consolidated, workbooks, concept_map, master_rows, file_headline_periods,
            audit, derived_audit, derive_quarters)
        truth = build_workbook_truth_index(workbooks, concept_map, master_rows, file_headline_periods)
        truth_fy22 = {k: v for k, v in truth.items() if k[1] == CANON and k[2] == FY22}
        fy22_after = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("9 WORKBOOK_TRUTH index", len(truth_fy22) > 0, f"truth={truth_fy22}")
        step("9 WORKBOOK_TRUTH cell", fy22_after is not None, f"FY22={fy22_after}")

        xbrl_by_stmt = {st: set(keys) for st, keys in xbrl_backed_period_canonicals_by_statement(workbooks).items()}
        wb_canons = {st: frozenset(c) for st, c in collect_workbook_canonical_concepts(workbooks, concept_map).items()}
        models, _ = _models_json(
            consolidated, master_rows, None,
            allowed_periods_by_statement={st: frozenset(k) for st, k in xbrl_by_stmt.items()},
            workbook_canons_by_statement=wb_canons,
        )
        qrow = next((r for r in models["cash_flow"]["quarterly"]["rows"] if r.get("concept") == CANON), None)
        step("10 MODEL", qrow and qrow.get(FY22) is not None,
             f"row present={bool(qrow)} FY22={qrow.get(FY22) if qrow else None} (label kept via master layout)")


if __name__ == "__main__":
    main()
