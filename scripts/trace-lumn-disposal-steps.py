"""Step-by-step trace: LUMN disposal CF FY22 through compiler. Prints PASS/FAIL per step."""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "xbrl-compiler"))

CANON = "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal"
LABEL = "Loss on disposal groups held for sale"
FY22 = "FY22"


def build_workbooks(out_dir: Path) -> list[str]:
    """Run TS script to materialize LUMN workbooks into out_dir."""
    script = ROOT / "scripts" / "trace-lumn-disposal-fy22-compile.ts"
    # Use inline node to only build full set - faster: call diag approach via subprocess
    ts = ROOT / "scripts" / "_materialize_lumn_full_set.ts"
    if not ts.exists():
        # fallback: run compile trace which builds files internally - we build here
        raise SystemExit("missing _materialize_lumn_full_set.ts")
    subprocess.run(["npx", "tsx", str(ts), str(out_dir)], cwd=ROOT, check=True, timeout=900_000)
    return sorted(p.name for p in out_dir.glob("*.xlsx"))


def step(name: str, ok: bool, detail: str) -> None:
    status = "PASS" if ok else "FAIL"
    print(f"\n[{status}] Step {name}")
    print(f"       {detail}")


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
        out = Path(td) / "out"
        inp.mkdir()
        out.mkdir()

        # Materialize via Node (full LUMN set since 2019)
        mat = ROOT / "scripts" / "_materialize_lumn_for_trace.ts"
        subprocess.run(
            f'npx tsx "{mat}" "{inp}"',
            cwd=ROOT,
            check=True,
            timeout=900_000,
            shell=True,
        )
        files = list(inp.glob("*.xlsx"))
        print(f"=== INPUT: {len(files)} workbooks ===")
        fy22_k = [f for f in files if "10-K_2023-02" in f.name]
        print(f"FY22 10-K files (2023-02): {[f.name for f in fy22_k]}")

        # Step 1: Load
        workbooks = load_all_workbooks(inp)
        loader_hits = []
        fy22_owner_loaded = False
        for wb in workbooks:
            if "2023-02" in wb.filename and wb.is_10k:
                fy22_owner_loaded = True
            for sh in wb.sheets:
                if sh.statement_type != "cash_flow":
                    continue
                for f in sh.facts:
                    if CANON in (f.concept or "") or LABEL.lower() in (f.line_label or "").lower():
                        if f.period.canonical == FY22 and abs(f.value - 700) < 1:
                            loader_hits.append((wb.filename, f.value, f.period.column_label))
        step(
            "1 LOAD — FY22 10-K in input folder",
            fy22_owner_loaded,
            f"found={fy22_owner_loaded} among {len(workbooks)} loaded workbooks",
        )
        step(
            "1 LOAD — parser extracted FY22=700 disposal fact",
            len(loader_hits) > 0,
            f"hits={loader_hits[:5]}" if loader_hits else "no CF fact with period=FY22 value≈700",
        )

        # Step 2: Master + map
        master_wb = pick_latest_10k(workbooks)
        master_rows, concept_map = build_master_presentation(master_wb, all_workbooks=workbooks)
        mapped, unresolved = map_all_facts(workbooks, concept_map, master_rows)
        mapped_fy22 = [
            m for m in mapped
            if m.canonical_row_id == CANON and m.statement_type == "cash_flow" and m.period.canonical == FY22
        ]
        cf_canon_in_master = any(
            r.canonical_row_id == CANON and r.statement_type == "cash_flow" for r in master_rows
        )
        step(
            "2 MAP — disposal row on master CF layout",
            cf_canon_in_master,
            f"master={master_wb.filename if master_wb else None} has_disposal_row={cf_canon_in_master}",
        )
        step(
            "2 MAP — FY22 disposal fact mapped to canonical row",
            len(mapped_fy22) > 0,
            f"mapped_fy22={[(m.value, m.source_file) for m in mapped_fy22]}",
        )

        # Step 3: Headline
        sorted_wbs = sorted(workbooks, key=lambda w: (w.latest_fy, w.filename))
        file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
        file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in workbooks}
        fy22_headline_owner = None
        for fn, periods in file_headline_periods.items():
            if FY22 in periods and "2023-02" in fn:
                fy22_headline_owner = fn
        step(
            "3 HEADLINE — FY22 owned by Feb-2023 10-K",
            fy22_headline_owner is not None,
            f"owner={fy22_headline_owner}",
        )

        # Step 4: Consolidate
        consolidated, audit, conflicts = consolidate(
            mapped, master_rows, file_recency, file_headline_periods,
        )
        cf_after = consolidated.get("cash_flow", {}).get(CANON, {})
        fy22_consolidated = cf_after.get(FY22)
        step(
            "4 CONSOLIDATE — FY22 cell set",
            fy22_consolidated is not None and abs(float(fy22_consolidated) - 700) < 1,
            f"FY22={fy22_consolidated}",
        )

        apply_coverage_pass(
            workbooks, master_rows, concept_map, consolidated, file_recency,
            mapped, unresolved, audit, file_headline_periods,
        )
        fy22_cov = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("5 COVERAGE — FY22 preserved", fy22_cov is not None, f"FY22={fy22_cov}")

        derive_quarters(consolidated, master_rows, audit)
        fy22_der = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("6 DERIVE — FY22 preserved", fy22_der is not None, f"FY22={fy22_der}")

        reconcile_final_statements_with_raw_xbrl(
            workbooks, master_rows, concept_map, consolidated, file_recency, audit, file_headline_periods,
        )
        fy22_rec = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("7 RECONCILE — FY22 preserved", fy22_rec is not None, f"FY22={fy22_rec}")

        apply_row_deduplication(consolidated, master_rows, concept_map, audit)
        fy22_ded = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        step("8 DEDUP — FY22 preserved", fy22_ded is not None, f"FY22={fy22_ded}")

        derived_audit: list = []
        run_workbook_truth_until_clean(
            consolidated, workbooks, concept_map, master_rows, file_headline_periods,
            audit, derived_audit, derive_quarters,
        )
        fy22_truth = consolidated.get("cash_flow", {}).get(CANON, {}).get(FY22)
        truth = build_workbook_truth_index(workbooks, concept_map, master_rows, file_headline_periods)
        truth_fy22 = {k: v for k, v in truth.items() if k[1] == CANON and k[2] == FY22}
        step(
            "9 WORKBOOK_TRUTH — FY22 in truth index",
            len(truth_fy22) > 0,
            f"truth_keys={list(truth_fy22.keys())[:3]} values={list(truth_fy22.values())[:3]}",
        )
        step(
            "9 WORKBOOK_TRUTH — FY22 cell survived enforce",
            fy22_truth is not None,
            f"FY22={fy22_truth} (cleared here if truth index missing)",
        )

        xbrl_by_stmt = {st: set(keys) for st, keys in xbrl_backed_period_canonicals_by_statement(workbooks).items()}
        wb_canons = {st: frozenset(c) for st, c in collect_workbook_canonical_concepts(workbooks, concept_map).items()}
        models, _ = _models_json(
            consolidated, master_rows, None,
            allowed_periods_by_statement={st: frozenset(k) for st, k in xbrl_by_stmt.items()},
            workbook_canons_by_statement=wb_canons,
        )
        qrows = models["cash_flow"]["quarterly"]["rows"]
        qrow = next((r for r in qrows if r.get("concept") == CANON), None)
        fy22_model = qrow.get(FY22) if qrow else None
        step(
            "10 MODEL — FY22 in compiled quarterly row",
            fy22_model is not None,
            f"line={qrow.get('line') if qrow else None} FY22={fy22_model} 4Q22={qrow.get('4Q22') if qrow else None}",
        )

        print("\n=== FIRST FAILING STEP (if any) ===")
        # already printed above


if __name__ == "__main__":
    main()
