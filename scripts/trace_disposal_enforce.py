"""Run full compiler on LUMN workbooks; trace disposal CF FY22 through pipeline."""
from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "xbrl-compiler"))

CANON = "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal"


def cell(data, step: str) -> None:
    v = data.get("cash_flow", {}).get(CANON, {})
    fy22 = v.get("FY22")
    print(f"{step:40s} FY22={fy22!r}  all={v}")


def main() -> None:
    import subprocess

    # Build 3 workbooks: FY22 + FY23 + FY24 10-K via node
    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "in"
        out = Path(td) / "out"
        inp.mkdir()
        out.mkdir()

        subprocess.run(
            ["npx.cmd", "tsx", str(ROOT / "scripts" / "trace-lumn-disposal-fy22-compile.ts")],
            cwd=ROOT,
            check=True,
            timeout=600_000,
            shell=True,
        )
        # trace script uses its own temp dirs — instead call main.run on manually built set

    # Inline: use main.run after building workbooks in this script's temp
    from workbook_loader import load_all_workbooks, pick_latest_10k
    from master_presentation_builder import build_master_presentation
    from row_mapper import map_all_facts
    from headline_periods import headline_periods_for_workbook
    from consolidator import consolidate
    from coverage_pass import apply_coverage_pass, reconcile_final_statements_with_raw_xbrl
    from derivation_engine import derive_quarters
    from row_deduplication import apply_row_deduplication
    from workbook_truth import (
        build_workbook_truth_index,
        run_workbook_truth_until_clean,
        enforce_workbook_truth,
        derived_cells_from_audit,
    )

    # Use trace script output - run compile via main
    from main import run as compiler_run

    with tempfile.TemporaryDirectory() as td:
        inp = Path(td) / "in"
        out = Path(td) / "out"
        inp.mkdir()
        out.mkdir()

        # Build FY22, FY23, FY24 only using subprocess to trace script helper
        subprocess.run(
            [
                "npx.cmd", "tsx", "-e",
                """
                import fs from 'fs'; import path from 'path'; import os from 'os';
                import { getAllFilingsByTickerCached } from './src/lib/sec-submissions-cache.ts';
                import { fetchFacePresentedStatements } from './src/lib/sec-ixbrl-face-extract.ts';
                import { buildFacePresentedStatementsWorkbook } from './src/lib/sec-ixbrl-face-save-client.ts';
                import { workbookToXlsxUint8Array } from './src/lib/sec-xbrl-presented-excel.ts';
                const outDir = process.argv[1];
                const res = await getAllFilingsByTickerCached('LUMN');
                const dates = ['2023-02','2024-02','2025-02'];
                for (const d of dates) {
                  const f = res.filings.find(x => x.form==='10-K' && x.filingDate.startsWith(d));
                  if (!f) continue;
                  const p = await fetchFacePresentedStatements({ cik: res.cik, accessionNumber: f.accessionNumber, form: f.form, filingDate: f.filingDate, primaryDocument: f.primaryDocument, docUrl: f.docUrl });
                  const wb = buildFacePresentedStatementsWorkbook({ ticker:'LUMN', cik:res.cik, filing:f, statements:p.statements });
                  const fn = 'LUMN_10K_'+d+'.xlsx';
                  fs.writeFileSync(path.join(outDir, fn), Buffer.from(workbookToXlsxUint8Array(wb)));
                }
                """.strip(),
                str(inp),
            ],
            cwd=ROOT,
            shell=True,
            timeout=300_000,
        )

        wbs = load_all_workbooks(inp)
        print("Files:", [w.filename for w in wbs])
        fy22_wb = [w for w in wbs if "2023-02" in w.filename or "FY22" in w.filename]
        print("FY22 wb:", [w.filename for w in fy22_wb])

        for wb in wbs:
            for sh in wb.sheets:
                if sh.statement_type != "cash_flow":
                    continue
                for f in sh.facts:
                    if CANON in f.concept and f.period.canonical == "FY22":
                        print(f"LOADER: {wb.filename} FY22 disposal={f.value}")

        master_wb = pick_latest_10k(wbs)
        master_rows, concept_map = build_master_presentation(master_wb, all_workbooks=wbs)
        mapped, unresolved = map_all_facts(wbs, concept_map, master_rows)
        sorted_wbs = sorted(wbs, key=lambda w: (w.latest_fy, w.filename))
        file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
        file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in wbs}
        print("Headlines:", {k: sorted(v) for k, v in file_headline_periods.items()})

        consolidated, audit, _ = consolidate(mapped, master_rows, file_recency, file_headline_periods)
        cell(consolidated, "after consolidate")

        _, _ = apply_coverage_pass(
            wbs, master_rows, concept_map, consolidated, file_recency, mapped, unresolved, audit, file_headline_periods,
        )
        cell(consolidated, "after coverage")

        derived = derive_quarters(consolidated, master_rows, audit)
        cell(consolidated, "after derive")

        rec = reconcile_final_statements_with_raw_xbrl(
            wbs, master_rows, concept_map, consolidated, file_recency, audit, file_headline_periods,
        )
        cell(consolidated, "after reconcile")

        apply_row_deduplication(consolidated, master_rows, concept_map, audit)
        cell(consolidated, "after dedup")

        truth = build_workbook_truth_index(wbs, concept_map, master_rows, file_headline_periods)
        print("TRUTH FY22 disposal:", {k: v for k, v in truth.items() if k[1] == CANON and k[2] == "FY22"})

        protected = derived_cells_from_audit(derived)
        cleared, aligned = enforce_workbook_truth(consolidated, truth, protected)
        print(f"enforce_workbook_truth: cleared={cleared} aligned={aligned}")
        cell(consolidated, "after enforce (pre-loop)")

        result = compiler_run(str(inp), str(out))
        models = result.get("models", {})
        cf = models.get("cash_flow", {}).get("quarterly", {})
        row = next((r for r in cf.get("rows", []) if r.get("concept") == CANON), None)
        print("\nFINAL API JSON row FY22:", row.get("FY22") if row else "NO ROW")


if __name__ == "__main__":
    main()
