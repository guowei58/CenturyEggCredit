"""Run HTZ compile and trace each pipeline stage with concrete evidence."""
from __future__ import annotations

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from consolidator import consolidate
from headline_periods import headline_periods_for_workbook
from master_presentation_builder import build_master_presentation
from row_mapper import map_all_facts
from workbook_loader import load_all_workbooks, pick_latest_10k
from xbrl_periods import (
    filter_facts_to_xbrl_periods,
    filter_workbooks_to_xbrl_tagged,
    is_xbrl_tagged_concept,
    workbook_has_xbrl_tagged_facts,
)

INPUT = Path(__file__).resolve().parents[2] / "scripts/.audit-truth-batch/work/HTZ/in"
OUT = Path(__file__).resolve().parents[2] / "scripts/.audit-truth-batch/work/HTZ/out-trace"


def concept_bucket(c: str) -> str:
    c = (c or "").strip()
    if c.startswith("html:"):
        return "html"
    if c.startswith("us-gaap:"):
        return "us-gaap"
    if c.startswith("htz:") or c.startswith("htzz:"):
        return "htz/htzz"
    if is_xbrl_tagged_concept(c):
        return "other-xbrl"
    return "other"


def short_fn(name: str) -> str:
    return name.replace("HTZ_SEC-XBRL-financials_as-presented_", "")


def trace_workbook_inventory(workbooks) -> dict:
    rows = []
    for wb in sorted(workbooks, key=lambda w: w.filename):
        pref = Counter()
        periods_by_stmt: dict[str, set[str]] = defaultdict(set)
        dropped_by_filter: dict[str, set[str]] = defaultdict(set)
        for sh in wb.sheets:
            before = {f.period.canonical for f in sh.facts if f.value is not None}
            after = {
                f.period.canonical
                for f in filter_facts_to_xbrl_periods(sh.facts)
                if f.value is not None
            }
            dropped_by_filter[sh.statement_type] = before - after
            for f in sh.facts:
                pref[concept_bucket(f.concept)] += 1
                if f.value is not None:
                    periods_by_stmt[sh.statement_type].add(f.period.canonical)
        rows.append(
            {
                "file": short_fn(wb.filename),
                "is_10k": wb.is_10k,
                "has_xbrl_tags": workbook_has_xbrl_tagged_facts(wb),
                "concept_mix": dict(pref),
                "headline_periods": sorted(headline_periods_for_workbook(wb)),
                "periods_by_statement": {k: sorted(v) for k, v in periods_by_stmt.items()},
                "periods_dropped_by_xbrl_filter": {
                    k: sorted(v) for k, v in dropped_by_filter.items() if v
                },
            }
        )
    return {"workbooks": rows}


def trace_missing_revenues(workbooks, concept_map, mapped) -> list[dict]:
    """For each 10-Q headline quarter, check Revenues in source vs mapped vs consolidated."""
    canon = "us-gaap:Revenues"
    cm_revenue_html = [
        m.raw_concept
        for m in concept_map
        if m.statement_type == "income_statement" and m.canonical_row_id == canon
    ]
    findings = []
    for wb in workbooks:
        if wb.is_10k:
            continue
        hp = headline_periods_for_workbook(wb)
        q_periods = [p for p in hp if p.startswith(("1Q", "2Q", "3Q", "4Q"))]
        if not q_periods:
            continue
        for sh in wb.sheets:
            if sh.statement_type != "income_statement":
                continue
            filtered = filter_facts_to_xbrl_periods(sh.facts)
            for period in q_periods:
                raw_rev = [
                    f
                    for f in filtered
                    if f.period.canonical == period
                    and f.value is not None
                    and (
                        f.concept == "us-gaap:Revenues"
                        or f.concept in cm_revenue_html
                        or "revenues" == f.concept.replace("html:", "")
                        or f.line_label.strip().lower() in ("revenues", "total revenues")
                    )
                ]
                mapped_rev = [
                    m
                    for m in mapped
                    if m.source_file == wb.filename
                    and m.canonical_row_id == canon
                    and m.period.canonical == period
                ]
                findings.append(
                    {
                        "file": short_fn(wb.filename),
                        "headline_period": period,
                        "raw_revenue_facts": len(raw_rev),
                        "raw_revenue_detail": [
                            {
                                "concept": f.concept,
                                "label": f.line_label,
                                "value": f.value,
                            }
                            for f in raw_rev
                        ],
                        "mapped_to_revenues": len(mapped_rev),
                        "mapped_values": [m.value for m in mapped_rev],
                    }
                )
    return findings


def trace_bad_collapses(concept_map) -> list[dict]:
    """Find multiple html concepts mapped to same canonical row where labels differ materially."""
    by_canon: dict[tuple[str, str], list] = defaultdict(list)
    for m in concept_map:
        if not m.raw_concept.startswith("html:"):
            continue
        by_canon[(m.statement_type, m.canonical_row_id)].append(m)

    bad = []
    for (st, canon), items in sorted(by_canon.items()):
        if len(items) < 2:
            continue
        labels = {i.notes for i in items}
        slugs = [i.raw_concept for i in items]
        # flag known-bad patterns
        slug_text = " ".join(slugs)
        if "depreciation" in slug_text and canon == "us-gaap:Revenues":
            bad.append(
                {
                    "issue": "depreciation_mapped_to_revenues",
                    "statement": st,
                    "canonical": canon,
                    "html_concepts": slugs,
                    "notes": list(labels)[:3],
                }
            )
        elif any(s in slug_text for s in ("beginning-of-period", "end-of-period")):
            bad.append(
                {
                    "issue": "cash_rollforward_components_same_row",
                    "statement": st,
                    "canonical": canon,
                    "html_concepts": slugs,
                }
            )
        elif len({i.raw_concept.split(":")[-1][:20] for i in items}) >= 2 and any(
            "vehicle" in s for s in slugs
        ):
            if canon.startswith("us-gaap:"):
                bad.append(
                    {
                        "issue": "multiple_html_vehicle_labels_same_usgaap_row",
                        "statement": st,
                        "canonical": canon,
                        "html_concepts": slugs[:8],
                        "count": len(items),
                    }
                )
    return bad


def trace_within_file_sums(audit_entries) -> list[dict]:
    sums = []
    for ae in audit_entries:
        if ae.source_method != "summed_within_file":
            continue
        sums.append(
            {
                "statement": ae.statement_type,
                "canonical": ae.canonical_row_id,
                "label": ae.master_display_label,
                "period": ae.output_period,
                "value": ae.value,
                "file": short_fn(ae.source_file),
                "raw_concepts": ae.raw_concept,
                "formula": ae.derivation_formula,
            }
        )
    return sums


def trace_duplicate_vehicle_master(master_rows) -> list[dict]:
    by_label: dict[tuple[str, str], list] = defaultdict(list)
    for r in master_rows:
        by_label[(r.statement_type, r.display_label.strip())].append(r.canonical_row_id)
    dups = []
    for (st, label), crids in sorted(by_label.items()):
        if label.lower() not in ("vehicle", "non-vehicle", "vehicles"):
            continue
        if len(crids) > 1:
            dups.append({"statement": st, "label": label, "canonical_rows": crids})
    return dups


def trace_consolidated_gaps(consolidated, audit_entries, target_row="us-gaap:Revenues", stmt="income_statement"):
    cells = consolidated.get(stmt, {}).get(target_row, {})
    audited = {ae.output_period for ae in audit_entries if ae.canonical_row_id == target_row and ae.statement_type == stmt}
    gaps = []
    for period in sorted(audited):
        if cells.get(period) is None:
            gaps.append({"period": period, "had_audit_elsewhere": period in audited})
    # periods with no audit at all among headline quarters 2022-2025
    for p in ["1Q22", "1Q23", "1Q24", "2Q23", "2Q24", "3Q23", "3Q24", "FY22", "FY23", "FY24"]:
        gaps.append(
            {
                "period": p,
                "consolidated_value": cells.get(p),
                "in_audit": p in audited,
            }
        )
    return gaps


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    workbooks = load_all_workbooks(INPUT)
    kept, skipped = filter_workbooks_to_xbrl_tagged(workbooks)
    master_wb = pick_latest_10k([w for w in kept if w.sheets])
    master_rows, concept_map = build_master_presentation(master_wb, all_workbooks=kept)
    mapped, unresolved = map_all_facts(kept, concept_map, master_rows)
    sorted_wbs = sorted(kept, key=lambda w: (w.latest_fy, w.filename))
    file_recency = {w.filename: i for i, w in enumerate(sorted_wbs)}
    file_headline_periods = {w.filename: headline_periods_for_workbook(w) for w in kept}
    consolidated, audit_entries, conflicts = consolidate(
        mapped, master_rows, file_recency, file_headline_periods
    )

    report = {
        "input_dir": str(INPUT),
        "workbook_count_loaded": len(workbooks),
        "workbook_count_compiled": len(kept),
        "skipped_html_only_batch": skipped,
        "html_only_workbooks_included": [
            short_fn(w.filename) for w in kept if not workbook_has_xbrl_tagged_facts(w)
        ],
        "tagged_only_workbooks": [
            short_fn(w.filename) for w in kept if workbook_has_xbrl_tagged_facts(w)
        ],
        "master_workbook": short_fn(master_wb.filename),
        "master_row_count": len(master_rows),
        "concept_map_count": len(concept_map),
        "mapped_facts": len(mapped),
        "unresolved_facts": len(unresolved),
        "consolidated_cell_count": sum(len(v) for cc in consolidated.values() for v in cc.values()),
        "conflict_count": len(conflicts),
        "within_file_sum_count": sum(1 for ae in audit_entries if ae.source_method == "summed_within_file"),
        "inventory": trace_workbook_inventory(kept),
        "missing_revenues_by_headline_10q": [
            f
            for f in trace_missing_revenues(kept, concept_map, mapped)
            if f["raw_revenue_facts"] == 0 or f["mapped_to_revenues"] == 0
        ],
        "bad_concept_map_collapses": trace_bad_collapses(concept_map),
        "duplicate_vehicle_master_rows": trace_duplicate_vehicle_master(master_rows),
        "revenues_cell_trace": trace_consolidated_gaps(consolidated, audit_entries),
        "sample_within_file_sums_is_revenues": [
            s
            for s in trace_within_file_sums(audit_entries)
            if s["canonical"] == "us-gaap:Revenues"
        ][:15],
        "sample_within_file_sums_cf_cash": [
            s
            for s in trace_within_file_sums(audit_entries)
            if "CashCashEquivalents" in s["canonical"]
        ][:10],
    }

    out_json = OUT / "trace_report.json"
    out_json.write_text(json.dumps(report, indent=2), encoding="utf-8")

    # human summary
    lines = [
        "# HTZ compile trace",
        "",
        f"Loaded {report['workbook_count_loaded']} workbooks; compiled {report['workbook_count_compiled']}",
        f"Master: {report['master_workbook']}",
        f"HTML-only 10-Q count: {len(report['html_only_workbooks_included'])}",
        f"Tagged 10-K count: {len(report['tagged_only_workbooks'])}",
        f"Within-file SUM events: {report['within_file_sum_count']}",
        "",
        "## Missing Revenues on headline 10-Q periods (source workbook has 0 revenue facts)",
    ]
    for f in report["missing_revenues_by_headline_10q"]:
        if f["raw_revenue_facts"] == 0:
            lines.append(
                f"- {f['file']} headline {f['headline_period']}: NO revenue row in saved workbook"
            )
    lines.append("")
    lines.append("## Bad concept-map collapses (verified in concept_map)")
    for b in report["bad_concept_map_collapses"][:20]:
        lines.append(f"- [{b['issue']}] {b['statement']} {b['canonical']}: {b.get('html_concepts', [])[:4]}")
    lines.append("")
    lines.append("## Duplicate Vehicle display labels on master (different canonical rows)")
    for d in report["duplicate_vehicle_master_rows"]:
        lines.append(f"- {d['statement']} '{d['label']}': {len(d['canonical_rows'])} rows")

    (OUT / "trace_summary.md").write_text("\n".join(lines), encoding="utf-8")
    print(out_json)
    print(OUT / "trace_summary.md")
    print(json.dumps({k: report[k] for k in report if k not in ("inventory", "sample_within_file_sums_is_revenues", "sample_within_file_sums_cf_cash")}, indent=2)[:8000])


if __name__ == "__main__":
    main()
