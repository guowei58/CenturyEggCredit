"""Quick diagnostic: find all BS concepts across files & show mapping fate.

Usage:
    python diagnose_bs.py --input <folder> [--search marketable,investment,intangible]
"""
from __future__ import annotations

import argparse
import re
import sys

from workbook_loader import load_all_workbooks, pick_latest_10k
from master_presentation_builder import (
    build_master_presentation,
    _extract_local_name,
    _normalize_label,
)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument(
        "--search",
        default="marketable,investment,intangible",
        help="comma-separated keywords to highlight",
    )
    args = ap.parse_args()

    keywords = [k.strip().lower() for k in args.search.split(",") if k.strip()]
    print(f"=== BS Concept Diagnostic  keywords={keywords} ===\n")

    wbs = load_all_workbooks(args.input)
    if not wbs:
        print("ERROR: no workbooks loaded"); return

    master = pick_latest_10k(wbs)
    if not master:
        print("ERROR: no master 10-K"); return

    print(f"Master 10-K: {master.filename}\n")

    # Build master presentation with deterministic matching only (no AI)
    master_rows, concept_map = build_master_presentation(master, all_workbooks=wbs)

    # Index concept map by (stmt, raw_concept)
    cm_idx: dict[tuple[str, str], tuple[str, str, str]] = {}
    for cm in concept_map:
        cm_idx[(cm.statement_type, cm.raw_concept)] = (
            cm.canonical_row_id, cm.mapping_status, cm.notes
        )

    # Master BS concepts
    print("─── Master 10-K Balance Sheet concepts ───")
    master_bs: list[str] = []
    for sh in master.sheets:
        if sh.statement_type == "balance_sheet":
            for c in sh.row_order:
                if c:
                    master_bs.append(c)
                    local = _extract_local_name(c)
                    label = sh.concept_to_line.get(c, "")
                    norm = _normalize_label(label)
                    hit = any(k in c.lower() or k in label.lower() for k in keywords)
                    mark = " <<<" if hit else ""
                    print(f"  {c}  |  label=\"{label}\"  |  local={local}  |  norm=\"{norm}\"{mark}")
    print(f"  Total: {len(master_bs)}\n")

    # Per-file BS concepts
    for wb in sorted(wbs, key=lambda w: w.filename):
        for sh in wb.sheets:
            if sh.statement_type != "balance_sheet":
                continue
            print(f"─── {wb.filename} / {sh.source_sheet} ───")
            for c in sh.row_order:
                if not c:
                    continue
                label = sh.concept_to_line.get(c, "")
                local = _extract_local_name(c)
                norm = _normalize_label(label)
                mapping = cm_idx.get(("balance_sheet", c))
                hit = any(k in c.lower() or k in label.lower() for k in keywords)
                mark = " <<<" if hit else ""

                if mapping:
                    canon, status, notes = mapping
                    same = "(SELF)" if canon == c else f"→ {canon}"
                    print(f"  [{status}] {c}  {same}  |  label=\"{label}\"{mark}")
                else:
                    print(f"  [UNMAPPED!] {c}  |  label=\"{label}\"{mark}")

                # Also show what periods this concept has data for
                periods = sorted(set(
                    f.period.column_label
                    for f in sh.facts
                    if f.concept == c and f.value is not None
                ))
                if periods and hit:
                    print(f"    periods with data: {periods}")

            print()


if __name__ == "__main__":
    main()
