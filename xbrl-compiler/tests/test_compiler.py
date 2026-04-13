"""Comprehensive unit tests for the deterministic XBRL statement compiler."""
from __future__ import annotations

import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from period_parser import parse_period, sort_period_labels, Period
from workbook_loader import (
    classify_tab,
    is_10k_filename,
    FactRecord,
    SheetData,
    WorkbookInfo,
    _filter_sparse_columns,
    SPARSE_COLUMN_THRESHOLD,
    normalize_fiscal_periods,
)
from master_presentation_builder import (
    build_master_presentation, MasterRow, ConceptMapping,
    _extract_local_name, _normalize_label,
)
from row_mapper import map_all_facts, MappedFact, UnresolvedRow
from consolidator import consolidate, AuditEntry, Conflict
from derivation_engine import derive_quarters
from validators import validate_all
from pathlib import Path

from coverage_pass import (
    register_row_order_concepts_not_in_map,
    collect_all_raw_xbrl_line_items,
    reconcile_final_statements_with_raw_xbrl,
)


# ── helpers ────────────────────────────────────────────────────────────────

def _p(label: str) -> Period:
    p = parse_period(label)
    assert p is not None, f"Cannot parse '{label}'"
    return p


def _fact(concept="us-gaap:Revenue", stmt="income_statement", plabel="FY15",
          value=100.0, line="Revenue", src="file1.xlsx", sheet="Income Statement") -> FactRecord:
    return FactRecord(statement_type=stmt, concept=concept, line_label=line,
                      period=_p(plabel), value=value, source_file=src,
                      source_sheet=sheet, source_column=plabel)


def _sheet(facts, stmt="income_statement", src="file1.xlsx", sheet_name="Income Statement"):
    order, seen = [], set()
    c2l, c2d = {}, {}
    for f in facts:
        if f.concept and f.concept not in seen:
            order.append(f.concept)
            seen.add(f.concept)
            c2l[f.concept] = f.line_label
            c2d[f.concept] = f.depth
    return SheetData(source_file=src, source_sheet=sheet_name,
                     statement_type=stmt, facts=facts, row_order=order,
                     concept_to_line=c2l, concept_to_depth=c2d)


def _wb(sheets, filename="file1.xlsx", is_10k=False, fy=2015):
    return WorkbookInfo(filename=filename, filepath=Path(filename),
                        is_10k=is_10k, latest_fy=fy, sheets=sheets)


# ===========================================================================
# Period parsing
# ===========================================================================

class TestPeriodParsing:
    def test_quarter(self):
        p = parse_period("1Q15")
        assert p and p.period_type == "Q1" and p.fiscal_year == 2015

    def test_all_quarters(self):
        for q in range(1, 5):
            p = parse_period(f"{q}Q22")
            assert p and p.period_type == f"Q{q}" and p.fiscal_year == 2022

    def test_fy(self):
        p = parse_period("FY20")
        assert p and p.period_type == "FY" and p.fiscal_year == 2020

    def test_6m(self):
        p = parse_period("6M18")
        assert p and p.period_type == "6M" and p.fiscal_year == 2018

    def test_9m(self):
        p = parse_period("9M19")
        assert p and p.period_type == "9M" and p.fiscal_year == 2019

    def test_none(self):
        assert parse_period("Revenue") is None
        assert parse_period("") is None

    def test_case_insensitive(self):
        assert parse_period("fy24") is not None

    def test_canonical(self):
        assert _p("1Q15").canonical == "1Q15"
        assert _p("FY20").canonical == "FY20"
        assert _p("6M18").canonical == "6M18"

    def test_sort(self):
        assert sort_period_labels(["FY15", "2Q15", "1Q15", "4Q15", "3Q15"]) == [
            "1Q15", "2Q15", "3Q15", "4Q15", "FY15"]

    def test_sort_multi_year(self):
        assert sort_period_labels(["FY16", "1Q15", "FY15", "1Q16"]) == [
            "1Q15", "FY15", "1Q16", "FY16"]


# ===========================================================================
# Tab classification
# ===========================================================================

class TestTabClassification:
    def test_exact_income(self):
        assert classify_tab("Income Statement") == "income_statement"

    def test_exact_bs(self):
        assert classify_tab("Balance Sheet") == "balance_sheet"

    def test_exact_cf(self):
        assert classify_tab("Cash Flow") == "cash_flow"
        assert classify_tab("Cash Flows") == "cash_flow"

    def test_keyword_ops(self):
        assert classify_tab("Consolidated Statements of Operations") == "income_statement"

    def test_keyword_cf(self):
        assert classify_tab("Consolidated Statements of Cash Flows") == "cash_flow"

    def test_skip(self):
        assert classify_tab("Notes") is None
        assert classify_tab("Meta") is None
        assert classify_tab("Validation") is None


# ===========================================================================
# 10-K detection
# ===========================================================================

class TestTenKDetection:
    def test_basic(self):
        assert is_10k_filename("SEC-XBRL-10-K-2023.xlsx")
        assert is_10k_filename("AAPL_10K_2023.xlsx")

    def test_not_10k(self):
        assert not is_10k_filename("SEC-XBRL-10-Q-2023.xlsx")
        assert not is_10k_filename("financials.xlsx")


# ===========================================================================
# Sparse column filtering
# ===========================================================================

class _MockCell:
    def __init__(self, value):
        self.value = value

class _MockWorksheet:
    """Minimal mock for openpyxl worksheet to test _filter_sparse_columns."""
    def __init__(self, data_rows: list[list]):
        self._rows = data_rows

    def iter_rows(self, min_row=1, values_only=False):
        for row_data in self._rows[min_row - 1:]:
            yield [_MockCell(v) for v in row_data]

class TestSparseColumnFilter:
    def test_sparse_column_dropped(self):
        """A column with < 50% fill of the best column is dropped."""
        pcols = [
            (1, _p("1Q15")),   # col 1
            (2, _p("FY15")),   # col 2
            (3, _p("6M15")),   # col 3 – sparse
        ]
        # 10 data rows; col1 has 10 values, col2 has 8, col3 has only 3
        rows = []
        for i in range(10):
            rows.append([
                float(i + 1),                          # col 1: always filled
                float(i + 100) if i < 8 else None,     # col 2: 8/10
                float(i + 200) if i < 3 else None,     # col 3: 3/10 = 30% of max
            ])
        ws = _MockWorksheet(rows)
        kept = _filter_sparse_columns(ws, 0, pcols)  # header_row=0 → data starts row 1
        kept_labels = {p.column_label for _, p in kept}
        assert "1Q15" in kept_labels
        assert "FY15" in kept_labels
        assert "6M15" not in kept_labels  # 3/10 = 30% < 50%

    def test_all_columns_kept_when_above_threshold(self):
        """Columns at or above 50% of max fill survive."""
        pcols = [
            (1, _p("1Q15")),
            (2, _p("FY15")),
        ]
        rows = [[100.0, 200.0]] * 10  # both fully filled
        ws = _MockWorksheet(rows)
        kept = _filter_sparse_columns(ws, 0, pcols)
        assert len(kept) == 2

    def test_empty_sheet_keeps_all(self):
        """If no column has any data, keep all (avoid division-by-zero)."""
        pcols = [(1, _p("1Q15")), (2, _p("FY15"))]
        rows = [[None, None]] * 5
        ws = _MockWorksheet(rows)
        kept = _filter_sparse_columns(ws, 0, pcols)
        assert len(kept) == 2

    def test_exactly_at_threshold_kept(self):
        """Column at exactly 50% of max fill is kept (>= threshold)."""
        pcols = [(1, _p("1Q15")), (2, _p("FY15"))]
        # col1: 10 values, col2: 5 values → 5/10 = 50% exactly
        rows = []
        for i in range(10):
            rows.append([float(i), float(i) if i < 5 else None])
        ws = _MockWorksheet(rows)
        kept = _filter_sparse_columns(ws, 0, pcols)
        assert len(kept) == 2


# ===========================================================================
# Fiscal year normalization (non-December FY end)
# ===========================================================================

class TestFiscalYearNormalization:
    """Test detection and correction of calendar-labeled quarters for
    companies with non-December fiscal year ends (e.g. FICO, Sep 30)."""

    def _make_sep_fy_workbook(self):
        """Simulate FICO-style labels: fiscal Q1 (Oct-Dec 2023) labeled as 4Q23,
        fiscal Q2 (Jan-Mar 2024) labeled as 1Q24, Q3 and Q4 correct."""
        facts = [
            _fact(concept="us-gaap:Revenue", plabel="4Q23", value=10, stmt="income_statement"),
            _fact(concept="us-gaap:Revenue", plabel="1Q24", value=20, stmt="income_statement"),
            _fact(concept="us-gaap:Revenue", plabel="3Q24", value=40, stmt="income_statement"),
            _fact(concept="us-gaap:Revenue", plabel="4Q24", value=50, stmt="income_statement"),
            _fact(concept="us-gaap:Revenue", plabel="FY24", value=120, stmt="income_statement"),
        ]
        sheet = _sheet(facts, stmt="income_statement", src="fico_10k.xlsx")
        return [_wb([sheet], filename="fico_10k.xlsx", is_10k=True, fy=2024)]

    def test_detect_sep_fy_offset(self):
        """Should detect the non-December FY end pattern."""
        wbs = self._make_sep_fy_workbook()
        from workbook_loader import _detect_quarter_offset
        assert _detect_quarter_offset(wbs), "Should detect non-December FY end"

    def test_normalize_remaps_quarters(self):
        """After normalization, 4Q23 becomes 1Q24, 1Q24 becomes 2Q24."""
        wbs = self._make_sep_fy_workbook()
        normalize_fiscal_periods(wbs)

        periods = {}
        for fact in wbs[0].sheets[0].facts:
            periods[fact.period.canonical] = fact.value

        assert periods.get("1Q24") == 10, "4Q23 should become 1Q24 (fiscal Q1)"
        assert periods.get("2Q24") == 20, "1Q24 should become 2Q24 (fiscal Q2)"
        assert periods.get("3Q24") == 40, "3Q24 stays (already correct)"
        assert periods.get("4Q24") == 50, "4Q24 stays (already correct)"
        assert periods.get("FY24") == 120, "FY24 stays unchanged"

    def test_no_offset_for_december_fy(self):
        """December FY end companies should not trigger normalization."""
        facts = [
            _fact(concept="us-gaap:Revenue", plabel="1Q24", value=10),
            _fact(concept="us-gaap:Revenue", plabel="2Q24", value=20),
            _fact(concept="us-gaap:Revenue", plabel="3Q24", value=30),
            _fact(concept="us-gaap:Revenue", plabel="4Q24", value=40),
            _fact(concept="us-gaap:Revenue", plabel="FY24", value=100),
        ]
        sheet = _sheet(facts)
        wbs = [_wb([sheet], fy=2024)]
        from workbook_loader import _detect_quarter_offset
        assert not _detect_quarter_offset(wbs), "December FY end should produce no offset"

    def test_normalize_across_multiple_workbooks(self):
        """Normalization applies to all workbooks, not just the detection source."""
        # 10-K with FY+Q4+Q3+4Q(prev)+1Q pattern
        facts_10k = [
            _fact(concept="us-gaap:Revenue", plabel="4Q23", value=10, src="fico_10k.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="1Q24", value=20, src="fico_10k.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="3Q24", value=40, src="fico_10k.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="4Q24", value=50, src="fico_10k.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="FY24", value=120, src="fico_10k.xlsx"),
        ]
        sheet_10k = _sheet(facts_10k, src="fico_10k.xlsx")

        # Q1 10-Q only has 4Q23 (= fiscal Q1 FY24)
        facts_q1 = [
            _fact(concept="us-gaap:Revenue", plabel="4Q22", value=8, src="fico_q1.xlsx"),
        ]
        sheet_q1 = _sheet(facts_q1, src="fico_q1.xlsx")

        wbs = [
            _wb([sheet_10k], filename="fico_10k.xlsx", is_10k=True, fy=2024),
            _wb([sheet_q1], filename="fico_q1.xlsx", is_10k=False, fy=2023),
        ]
        normalize_fiscal_periods(wbs)

        q1_facts = wbs[1].sheets[0].facts
        assert q1_facts[0].period.canonical == "1Q23", "4Q22 in Q1 10-Q should become 1Q23"

    def test_cumulative_6m_with_offset(self):
        """6M period should NOT be shifted for September FY end (ends in same calendar year)."""
        facts = [
            _fact(concept="us-gaap:Revenue", plabel="4Q23", value=10, src="fico.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="1Q24", value=20, src="fico.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="3Q24", value=40, src="fico.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="4Q24", value=50, src="fico.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="FY24", value=120, src="fico.xlsx"),
            _fact(concept="us-gaap:Revenue", plabel="6M24", value=30, src="fico.xlsx", sheet="Cash Flow"),
        ]
        sheet = _sheet(facts, src="fico.xlsx")
        wbs = [_wb([sheet], filename="fico.xlsx", is_10k=True, fy=2024)]
        normalize_fiscal_periods(wbs)

        periods = {f.period.canonical: f.value for f in wbs[0].sheets[0].facts}
        assert periods.get("6M24") == 30, "6M24 should stay (Sep FY: 6M ends in March, same cal year)"


# ===========================================================================
# Master presentation
# ===========================================================================

class TestMasterPresentation:
    def test_build_from_10k(self):
        sheets = [
            _sheet([
                _fact("us-gaap:Revenue", line="Revenue"),
                _fact("us-gaap:COGS", line="Cost of goods sold"),
            ]),
        ]
        wb = _wb(sheets, filename="10-K.xlsx", is_10k=True)
        rows, cmap = build_master_presentation(wb)
        assert len(rows) == 2
        assert rows[0].canonical_row_id == "us-gaap:Revenue"
        assert rows[0].display_label == "Revenue"
        assert rows[1].canonical_row_id == "us-gaap:COGS"
        assert len(cmap) == 2

    def test_concept_map_seeds_correctly(self):
        sheets = [_sheet([_fact("us-gaap:Assets", stmt="balance_sheet", sheet="Balance Sheet")])]
        wb = _wb(sheets, is_10k=True)
        _, cmap = build_master_presentation(wb)
        assert cmap[0].raw_concept == "us-gaap:Assets"
        assert cmap[0].canonical_row_id == "us-gaap:Assets"
        assert cmap[0].mapping_status == "auto_from_master"

    def test_other_workbooks_add_missing_concepts(self):
        """Concepts in older filings with no name/label match get new rows."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue", src="old_10Q.xlsx"),
            _fact("custom:OldExpense", line="Old Expense", src="old_10Q.xlsx"),
        ], src="old_10Q.xlsx")
        old_wb = _wb([old_sh], "old_10Q.xlsx", False, 2020)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        concepts = {r.canonical_row_id for r in rows}
        assert "us-gaap:Revenue" in concepts
        assert "custom:OldExpense" in concepts
        assert len(rows) == 2

        statuses = {m.raw_concept: m.mapping_status for m in cmap}
        assert statuses["us-gaap:Revenue"] == "auto_from_master"
        assert statuses["custom:OldExpense"] == "auto_from_filing"

    def test_unmatched_after_mapped_comes_after_anchor(self):
        """An unmatched concept that follows a mapped concept is positioned
        after it, not dumped at the end."""
        master_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("us-gaap:COGS", line="COGS"),
        ])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue", src="q.xlsx"),
            _fact("custom:OldLine", line="Old Line", src="q.xlsx"),
            _fact("us-gaap:COGS", line="COGS", src="q.xlsx"),
        ], src="q.xlsx")
        old_wb = _wb([old_sh], "q.xlsx", False, 2018)

        rows, _ = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        order = {r.canonical_row_id: r.display_order for r in rows}
        assert order["us-gaap:Revenue"] < order["custom:OldLine"]
        assert order["custom:OldLine"] < order["us-gaap:COGS"]

    def test_no_duplicate_concepts_across_files(self):
        """A concept appearing in multiple files is only registered once."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        q1 = _wb([_sheet([_fact("us-gaap:Revenue", src="q1.xlsx")], src="q1.xlsx")], "q1.xlsx", False, 2024)
        q2 = _wb([_sheet([_fact("us-gaap:Revenue", src="q2.xlsx")], src="q2.xlsx")], "q2.xlsx", False, 2024)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, q1, q2])
        assert len(rows) == 1
        assert len(cmap) == 1

    # ── Local-name matching ───────────────────────────────────────────
    def test_local_name_match_different_namespace(self):
        """cabo:Revenue matches us-gaap:Revenue by local name 'Revenue'."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([_fact("cabo:Revenue", line="Revenue", src="old.xlsx")], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        assert len(rows) == 1  # no new row created
        cabo_map = [m for m in cmap if m.raw_concept == "cabo:Revenue"]
        assert len(cabo_map) == 1
        assert cabo_map[0].canonical_row_id == "us-gaap:Revenue"
        assert cabo_map[0].mapping_status == "auto_local_name"

    def test_local_name_match_does_not_create_extra_row(self):
        """Local-name matched concepts should NOT appear as separate MasterRows."""
        master_sh = _sheet([
            _fact("us-gaap:Assets", line="Total Assets", stmt="balance_sheet", sheet="Balance Sheet"),
        ], stmt="balance_sheet", sheet_name="Balance Sheet")
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("cabo:Assets", line="Total Assets", src="q.xlsx", stmt="balance_sheet", sheet="Balance Sheet"),
        ], src="q.xlsx", stmt="balance_sheet", sheet_name="Balance Sheet")
        old_wb = _wb([old_sh], "q.xlsx", False, 2018)

        rows, _ = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 1
        assert rows[0].canonical_row_id == "us-gaap:Assets"

    def test_balance_sheet_norm_label_match_disabled(self):
        """Distinct BS tags must not merge on label text alone (FICO-style intangibles)."""
        master_sh = _sheet([
            _fact("us-gaap:Goodwill", line="Goodwill", stmt="balance_sheet", sheet="Balance Sheet"),
        ], stmt="balance_sheet", sheet_name="Balance Sheet")
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact(
                "custom:OtherIntangible",
                line="Goodwill",
                src="old.xlsx",
                stmt="balance_sheet",
                sheet="Balance Sheet",
            ),
        ], src="old.xlsx", stmt="balance_sheet", sheet_name="Balance Sheet")
        old_wb = _wb([old_sh], "old.xlsx", False, 2016)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 2
        by_raw = {m.raw_concept: m.canonical_row_id for m in cmap}
        assert by_raw["us-gaap:Goodwill"] == "us-gaap:Goodwill"
        assert by_raw["custom:OtherIntangible"] == "custom:OtherIntangible"

    # ── Normalized-label matching ─────────────────────────────────────
    def test_label_match_plural_difference(self):
        """'Revenues' in old filing matches 'Revenue' in master via normalization."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:TotalRev", line="Revenues", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2016)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        assert len(rows) == 1
        rev_map = [m for m in cmap if m.raw_concept == "custom:TotalRev"]
        assert len(rev_map) == 1
        assert rev_map[0].canonical_row_id == "us-gaap:Revenue"
        assert rev_map[0].mapping_status == "auto_label_match"

    def test_label_match_ampersand_vs_and(self):
        """'Selling, General & Administrative' matches 'Selling, General and Administrative'."""
        master_sh = _sheet([_fact("us-gaap:SGA", line="Selling, General and Administrative Expense")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:OldSGA", line="Selling, General & Administrative Expenses", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2015)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 1
        sga_map = [m for m in cmap if m.raw_concept == "custom:OldSGA"]
        assert sga_map[0].canonical_row_id == "us-gaap:SGA"
        assert sga_map[0].mapping_status == "auto_label_match"

    def test_label_match_total_prefix_stripped(self):
        """'Total Revenue' matches 'Revenue' because leading 'Total' is stripped."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:TotRev", line="Total Revenue", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2017)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 1
        m = [x for x in cmap if x.raw_concept == "custom:TotRev"][0]
        assert m.canonical_row_id == "us-gaap:Revenue"

    def test_label_match_parenthetical_stripped(self):
        """'Net income (loss)' matches 'Net income' because parens are removed."""
        master_sh = _sheet([_fact("us-gaap:NetIncome", line="Net income")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:NI", line="Net income (loss)", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2015)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 1
        m = [x for x in cmap if x.raw_concept == "custom:NI"][0]
        assert m.canonical_row_id == "us-gaap:NetIncome"

    def test_no_match_creates_new_row(self):
        """Concepts with different local name AND different label create new rows."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:WidgetSales", line="Widget Sales", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2015)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        assert len(rows) == 2
        ws_map = [m for m in cmap if m.raw_concept == "custom:WidgetSales"]
        assert ws_map[0].mapping_status == "auto_from_filing"

    # ── Positional insertion tests ────────────────────────────────────
    def test_unmatched_inserted_after_anchor(self):
        """An unmatched concept that appears after Revenue in an old filing
        should be positioned after Revenue in the output, not at the bottom."""
        master_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("us-gaap:COGS", line="COGS"),
            _fact("us-gaap:NetIncome", line="Net income"),
        ])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue", src="old.xlsx"),
            _fact("custom:SpecialGain", line="Special Gain", src="old.xlsx"),
            _fact("us-gaap:COGS", line="COGS", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, _ = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        order = {r.canonical_row_id: r.display_order for r in rows}
        assert order["us-gaap:Revenue"] < order["custom:SpecialGain"]
        assert order["custom:SpecialGain"] < order["us-gaap:COGS"]

    def test_multiple_unmatched_preserve_relative_order(self):
        """Two unmatched items after the same anchor keep their source order."""
        master_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("us-gaap:NetIncome", line="Net income"),
        ])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue", src="old.xlsx"),
            _fact("custom:GainA", line="Gain A", src="old.xlsx"),
            _fact("custom:GainB", line="Gain B", src="old.xlsx"),
            _fact("us-gaap:NetIncome", line="Net income", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, _ = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        order = {r.canonical_row_id: r.display_order for r in rows}
        assert order["us-gaap:Revenue"] < order["custom:GainA"]
        assert order["custom:GainA"] < order["custom:GainB"]
        assert order["custom:GainB"] < order["us-gaap:NetIncome"]

    def test_unmatched_at_start_of_sheet_goes_to_top(self):
        """Unmatched concept before any mapped concept goes near the top."""
        master_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("us-gaap:NetIncome", line="Net income"),
        ])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:Header", line="Header item", src="old.xlsx"),
            _fact("us-gaap:Revenue", line="Revenue", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, _ = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])

        order = {r.canonical_row_id: r.display_order for r in rows}
        assert order["custom:Header"] < order["us-gaap:Revenue"]

    def test_local_name_takes_priority_over_label(self):
        """Local-name match fires before label match is attempted."""
        master_sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("us-gaap:OtherIncome", line="Other Income"),
        ])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("cabo:Revenue", line="Other Income", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        _, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, old_wb])
        m = [x for x in cmap if x.raw_concept == "cabo:Revenue"][0]
        assert m.canonical_row_id == "us-gaap:Revenue"
        assert m.mapping_status == "auto_local_name"


# ===========================================================================
# Label normalization unit tests
# ===========================================================================

class TestLabelNormalization:
    def test_extract_local_name_colon(self):
        assert _extract_local_name("us-gaap:Revenue") == "Revenue"
        assert _extract_local_name("cabo:SomeCustom") == "SomeCustom"

    def test_extract_local_name_slash(self):
        assert _extract_local_name("http://fasb.org/us-gaap/2024/Revenue") == "Revenue"

    def test_extract_local_name_bare(self):
        assert _extract_local_name("Revenue") == "Revenue"

    def test_normalize_lowercase(self):
        assert _normalize_label("REVENUE") == "revenue"

    def test_normalize_parenthetical_removed(self):
        assert _normalize_label("Net income (loss)") == "net income"

    def test_normalize_ampersand(self):
        result = _normalize_label("Selling, General & Administrative")
        assert "and" in result
        assert "&" not in result

    def test_normalize_plural_expense(self):
        assert _normalize_label("Operating expenses") == "operating expense"

    def test_normalize_plural_revenue(self):
        assert _normalize_label("Total Revenues") == "revenue"

    def test_normalize_strip_total(self):
        assert _normalize_label("Total Revenue") == "revenue"

    def test_normalize_trailing_punctuation(self):
        assert _normalize_label("Cash and equivalents:") == "cash and equivalent"

    def test_normalize_whitespace(self):
        assert _normalize_label("  Net   income  ") == "net income"

    def test_normalize_complex(self):
        result = _normalize_label("Total Selling, General & Administrative Expenses (excluding depreciation)")
        assert result == "selling general and administrative expense"

    # ── General de-pluralization tests ────────────────────────────────
    def test_normalize_equivalents(self):
        """The exact case the user reported: 'equivalents' → 'equivalent'."""
        assert _normalize_label("Cash and cash equivalents") == "cash and cash equivalent"
        assert _normalize_label("Cash and Cash Equivalent") == "cash and cash equivalent"

    def test_normalize_general_trailing_s(self):
        assert _normalize_label("Dividend payments") == "dividend payment"
        assert _normalize_label("Financial instruments") == "financial instrument"
        assert _normalize_label("Contract assets") == "contract asset"
        assert _normalize_label("Operating accounts") == "operating account"

    def test_normalize_ies_to_y(self):
        assert _normalize_label("Subsidiaries") == "subsidiary"
        assert _normalize_label("Inventories") == "inventory"

    def test_normalize_preserves_ss_words(self):
        """Words ending in 'ss' should NOT be de-pluralized."""
        assert "loss" in _normalize_label("Net loss")
        assert "gross" in _normalize_label("Gross profit")

    def test_normalize_preserves_us_words(self):
        """Words ending in 'us' should NOT be de-pluralized."""
        assert "surplus" in _normalize_label("Accumulated surplus")

    def test_normalize_preserves_is_words(self):
        """Words ending in 'is' should NOT be de-pluralized."""
        assert "basis" in _normalize_label("Tax basis")

    # ── Verbose XBRL condenser tests ──────────────────────────────────
    def test_condenser_amount_of_prefix(self):
        assert _normalize_label("Amount of depreciation expense") == "depreciation expense"

    def test_condenser_aggregate_amount_of(self):
        assert _normalize_label("Aggregate amount of goodwill") == "goodwill"

    def test_condenser_net_of_tax(self):
        a = _normalize_label("Other comprehensive income, net of tax")
        b = _normalize_label("Other comprehensive income")
        assert a == b

    def test_condenser_net_of_income_taxes(self):
        a = _normalize_label("Unrealized gains, net of income taxes")
        b = _normalize_label("Unrealized gains")
        assert a == b

    def test_condenser_before_addition_of_income_from(self):
        """The exact case the user reported."""
        verbose = (
            "Amount of income (loss) from continuing operations, net of tax, "
            "before addition of income (loss) from equity method investments."
        )
        terse = "Income (Loss) from Continuing Operations before Equity Method Investments"
        assert _normalize_label(verbose) == _normalize_label(terse)

    def test_condenser_before_deduction(self):
        a = _normalize_label("Revenue before deduction for returns")
        b = _normalize_label("Revenue before returns")
        assert a == b

    def test_condenser_does_not_strip_meaningful_text(self):
        """Condenser should not corrupt labels that don't have filler."""
        assert _normalize_label("Revenue") == "revenue"
        assert _normalize_label("Net income") == "net income"
        assert _normalize_label("Income before income tax") == "income before income tax"

    def test_taxes_depluralization(self):
        assert _normalize_label("Income taxes") == "income tax"
        assert _normalize_label("Provision for income taxes") == "provision for income tax"

    def test_losses_depluralization(self):
        assert _normalize_label("Net losses") == "net loss"
        assert _normalize_label("Unrealized losses") == "unrealized loss"


# ===========================================================================
# Row mapping – concept-based identity
# ===========================================================================

class TestRowMapping:
    def test_same_concept_different_labels(self):
        """Same Concept across files maps to same canonical row."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2015)
        rows, cmap = build_master_presentation(master_wb)

        other_sh = _sheet([_fact("us-gaap:Revenue", line="Total Revenue", src="10-Q.xlsx")], src="10-Q.xlsx")
        other_wb = _wb([other_sh], "10-Q.xlsx", False, 2015)

        mapped, unresolved = map_all_facts([master_wb, other_wb], cmap, rows)
        canon_ids = {m.canonical_row_id for m in mapped}
        assert canon_ids == {"us-gaap:Revenue"}
        assert len(unresolved) == 0

    def test_different_concept_same_label(self):
        """Different Concepts → different canonical rows."""
        sh = _sheet([
            _fact("us-gaap:Revenue", line="Revenue"),
            _fact("custom:OtherRevenue", line="Revenue"),
        ])
        wb = _wb([sh], "10-K.xlsx", True)
        rows, cmap = build_master_presentation(wb)
        mapped, _ = map_all_facts([wb], cmap, rows)
        canon_ids = {m.canonical_row_id for m in mapped}
        assert len(canon_ids) == 2

    def test_blank_concept_unresolved(self):
        master_sh = _sheet([_fact("us-gaap:Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True)
        rows, cmap = build_master_presentation(master_wb)

        bad_sh = _sheet([_fact("", line="Mystery", src="bad.xlsx")], src="bad.xlsx")
        bad_wb = _wb([bad_sh], "bad.xlsx")

        _, unresolved = map_all_facts([master_wb, bad_wb], cmap, rows)
        assert any("Blank" in u.reason for u in unresolved)

    def test_unmapped_concept_unresolved(self):
        """Without all_workbooks, a non-master concept is unresolved."""
        master_sh = _sheet([_fact("us-gaap:Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True)
        rows, cmap = build_master_presentation(master_wb)

        other_sh = _sheet([_fact("custom:FooBar", src="q.xlsx")], src="q.xlsx")
        other_wb = _wb([other_sh], "q.xlsx")

        _, unresolved = map_all_facts([master_wb, other_wb], cmap, rows)
        assert any(u.concept == "custom:FooBar" for u in unresolved)

    def test_old_concept_resolved_when_all_workbooks_passed(self):
        """With all_workbooks, an old concept gets added to the map and is mapped."""
        master_sh = _sheet([_fact("us-gaap:Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        other_sh = _sheet([_fact("custom:OldConcept", line="Old Item", src="q.xlsx")], src="q.xlsx")
        other_wb = _wb([other_sh], "q.xlsx", False, 2018)

        rows, cmap = build_master_presentation(master_wb, all_workbooks=[master_wb, other_wb])
        mapped, unresolved = map_all_facts([master_wb, other_wb], cmap, rows)

        mapped_concepts = {m.raw_concept for m in mapped}
        assert "custom:OldConcept" in mapped_concepts
        assert not any(u.concept == "custom:OldConcept" for u in unresolved)


# ===========================================================================
# Income statement 4Q derivation
# ===========================================================================

class TestIS4Q:
    def test_derive_4q(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0, "FY15": 500.0}}}
        da = derive_quarters(data, rows, [])
        assert data["income_statement"]["R"]["4Q15"] == 170.0
        assert any(a.source_method == "derived" for a in da)

    def test_no_derive_missing_fy(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0}}}
        derive_quarters(data, rows, [])
        assert "4Q15" not in data["income_statement"]["R"]

    def test_reported_4q_placeholder_overwritten(self):
        """Stale/wrong 4Q from consolidation is replaced by FY−Q1−Q2−Q3."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        reported = [AuditEntry("income_statement", "R", "Revenue", "4Q15", 999.0,
                               "f.xlsx", "IS", "4Q15", "Revenue", "R", "reported")]
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0,
                                           "FY15": 500.0, "4Q15": 999.0}}}
        derive_quarters(data, rows, reported)
        assert data["income_statement"]["R"]["4Q15"] == 170.0

    def test_derive_4q_missing_quarters_treated_as_zero(self):
        """If FY exists but some quarters are missing, treat missing as 0."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        data = {"income_statement": {"R": {"FY15": 500.0, "1Q15": 100.0}}}
        da = derive_quarters(data, rows, [])
        assert data["income_statement"]["R"]["4Q15"] == 400.0
        audit_4q = [a for a in da if a.output_period == "4Q15"]
        assert len(audit_4q) == 1
        assert "not reported" in audit_4q[0].derivation_formula

    def test_derive_4q_only_fy_exists(self):
        """If only FY exists, 4Q = FY - 0 - 0 - 0 = FY."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        data = {"income_statement": {"R": {"FY15": 500.0}}}
        derive_quarters(data, rows, [])
        assert data["income_statement"]["R"]["4Q15"] == 500.0


# ===========================================================================
# Cash flow derivations
# ===========================================================================

class TestCFDerivation:
    def test_2q(self):
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"1Q15": 50.0, "6M15": 130.0}}}
        derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["2Q15"] == 80.0

    def test_3q(self):
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"6M15": 130.0, "9M15": 200.0}}}
        derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["3Q15"] == 70.0

    def test_4q(self):
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"9M15": 200.0, "FY15": 280.0}}}
        derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["4Q15"] == 80.0

    def test_2q_missing_6m(self):
        """Cannot derive 2Q without the cumulative 6M — that stays missing."""
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"1Q15": 50.0}}}
        derive_quarters(data, rows, [])
        assert "2Q15" not in data["cash_flow"]["C"]

    def test_2q_missing_1q_treated_as_zero(self):
        """6M exists but 1Q absent → 2Q = 6M - 0 = 6M (the CABO scenario)."""
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"6M15": 20.0}}}
        da = derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["2Q15"] == 20.0
        audit_2q = [a for a in da if a.output_period == "2Q15"]
        assert len(audit_2q) == 1
        assert "not reported" in audit_2q[0].derivation_formula

    def test_3q_missing_6m_treated_as_zero(self):
        """9M exists but 6M absent → 3Q = 9M - 0 = 9M."""
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"9M15": 35.0}}}
        da = derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["3Q15"] == 35.0
        assert "not reported" in da[0].derivation_formula

    def test_4q_missing_9m_treated_as_zero(self):
        """FY exists but 9M absent → 4Q = FY - 0 = FY."""
        rows = [MasterRow("cash_flow", "C", "C", "NetCash", 0, 0)]
        data = {"cash_flow": {"C": {"FY15": 50.0}}}
        da = derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["4Q15"] == 50.0
        assert "not reported" in da[0].derivation_formula

    def test_cf_full_chain_with_sporadic_item(self):
        """A line item only in 6M and FY → derives 2Q=6M, 3Q=0, 4Q=FY-0."""
        rows = [MasterRow("cash_flow", "C", "C", "Debt investment", 0, 0)]
        data = {"cash_flow": {"C": {"6M15": 20.0, "FY15": 45.0}}}
        derive_quarters(data, rows, [])
        assert data["cash_flow"]["C"]["2Q15"] == 20.0
        assert data["cash_flow"]["C"]["4Q15"] == 45.0


# ===========================================================================
# Balance sheet 4Q = FY
# ===========================================================================

class TestBS4Q:
    def test_4q_equals_fy(self):
        rows = [MasterRow("balance_sheet", "A", "A", "Assets", 0, 0)]
        data = {"balance_sheet": {"A": {"FY15": 5000.0}}}
        da = derive_quarters(data, rows, [])
        assert data["balance_sheet"]["A"]["4Q15"] == 5000.0
        assert any(a.source_method == "copied_from_fy_for_bs" for a in da)


# ===========================================================================
# Conflict / duplicate detection
# ===========================================================================

class TestConflicts:
    def test_identical_duplicates_no_conflict(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "a.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "b.xlsx", "IS", "FY15", "Revenue", "R"),
        ]
        data, _, conflicts = consolidate(facts, rows)
        assert data["income_statement"]["R"]["FY15"] == 100.0
        assert len(conflicts) == 0

    def test_conflicting_values_logged(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "old.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 200.0,
                       "new.xlsx", "IS", "FY15", "Revenue", "R"),
        ]
        _, _, conflicts = consolidate(facts, rows)
        assert len(conflicts) == 1

    def test_most_recent_file_wins(self):
        """When two files differ, the one with the higher recency rank is used."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "old_10Q.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 250.0,
                       "new_10K.xlsx", "IS", "FY15", "Revenue", "R"),
        ]
        recency = {"old_10Q.xlsx": 0, "new_10K.xlsx": 1}
        data, audit, conflicts = consolidate(facts, rows, file_recency=recency)
        assert data["income_statement"]["R"]["FY15"] == 250.0
        assert audit[0].source_file == "new_10K.xlsx"
        assert len(conflicts) == 1
        assert "new_10K.xlsx" in conflicts[0].resolution

    def test_most_recent_wins_even_identical(self):
        """Even with identical values, the audit trail should reference the most-recent file."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "old.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "new.xlsx", "IS", "FY15", "Revenue", "R"),
        ]
        recency = {"old.xlsx": 0, "new.xlsx": 1}
        _, audit, _ = consolidate(facts, rows, file_recency=recency)
        assert audit[0].source_file == "new.xlsx"

    def test_three_files_newest_wins(self):
        """Three files provide the same cell — newest wins."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                       "oldest.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 150.0,
                       "middle.xlsx", "IS", "FY15", "Revenue", "R"),
            MappedFact("income_statement", "R", "Revenue", _p("FY15"), 200.0,
                       "newest.xlsx", "IS", "FY15", "Revenue", "R"),
        ]
        recency = {"oldest.xlsx": 0, "middle.xlsx": 1, "newest.xlsx": 2}
        data, _, _ = consolidate(facts, rows, file_recency=recency)
        assert data["income_statement"]["R"]["FY15"] == 200.0


# ===========================================================================
# Sub-component summing within a single file
# ===========================================================================

class TestWithinFileSum:
    def test_two_concepts_same_file_summed(self):
        """Two different raw concepts in the same file mapped to same canon row → sum."""
        rows = [MasterRow("income_statement", "G", "G", "Gain on sales", 0, 0)]
        facts = [
            MappedFact("income_statement", "G", "Gain on sales", _p("FY20"), 50.0,
                       "file.xlsx", "IS", "FY20", "Gain on asset sales", "custom:GainAsset"),
            MappedFact("income_statement", "G", "Gain on sales", _p("FY20"), 30.0,
                       "file.xlsx", "IS", "FY20", "Gain on business sales", "custom:GainBiz"),
        ]
        data, audit, conflicts = consolidate(facts, rows)
        assert data["income_statement"]["G"]["FY20"] == 80.0
        assert len(conflicts) == 0
        assert any(a.source_method == "summed_within_file" for a in audit)

    def test_three_concepts_same_file_summed(self):
        """Three sub-components in the same file → sum all."""
        rows = [MasterRow("income_statement", "E", "E", "Operating expense", 0, 0)]
        facts = [
            MappedFact("income_statement", "E", "OpEx", _p("FY20"), 100.0,
                       "file.xlsx", "IS", "FY20", "R&D", "custom:RD"),
            MappedFact("income_statement", "E", "OpEx", _p("FY20"), 200.0,
                       "file.xlsx", "IS", "FY20", "SG&A", "custom:SGA"),
            MappedFact("income_statement", "E", "OpEx", _p("FY20"), 50.0,
                       "file.xlsx", "IS", "FY20", "Depreciation", "custom:Dep"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["E"]["FY20"] == 350.0

    def test_same_concept_same_file_not_summed(self):
        """Same raw concept twice in same file (true duplicate) → pick one, not sum."""
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "R", "Revenue", _p("FY20"), 100.0,
                       "file.xlsx", "IS", "FY20", "Revenue", "us-gaap:Rev"),
            MappedFact("income_statement", "R", "Revenue", _p("FY20"), 100.0,
                       "file.xlsx", "IS", "FY20", "Revenue", "us-gaap:Rev"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["R"]["FY20"] == 100.0

    def test_sum_within_file_then_most_recent_across_files(self):
        """File A sums sub-components, file B has a single value → most recent wins."""
        rows = [MasterRow("income_statement", "G", "G", "Gain", 0, 0)]
        facts = [
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 50.0,
                       "old.xlsx", "IS", "FY20", "Gain on asset", "custom:GA"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 30.0,
                       "old.xlsx", "IS", "FY20", "Gain on biz", "custom:GB"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 90.0,
                       "new.xlsx", "IS", "FY20", "Gain on sales", "us-gaap:Gain"),
        ]
        recency = {"old.xlsx": 0, "new.xlsx": 1}
        data, _, _ = consolidate(facts, rows, file_recency=recency)
        assert data["income_statement"]["G"]["FY20"] == 90.0

    def test_sum_within_file_wins_when_more_recent(self):
        """Newer file has sub-components, older file has consolidated → newer sum wins."""
        rows = [MasterRow("income_statement", "G", "G", "Gain", 0, 0)]
        facts = [
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 90.0,
                       "old.xlsx", "IS", "FY20", "Gain", "us-gaap:Gain"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 50.0,
                       "new.xlsx", "IS", "FY20", "Gain on asset", "custom:GA"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 30.0,
                       "new.xlsx", "IS", "FY20", "Gain on biz", "custom:GB"),
        ]
        recency = {"old.xlsx": 0, "new.xlsx": 1}
        data, _, _ = consolidate(facts, rows, file_recency=recency)
        assert data["income_statement"]["G"]["FY20"] == 80.0

    def test_audit_trail_for_summed_value(self):
        """Summed values record the formula and all component concepts."""
        rows = [MasterRow("income_statement", "G", "G", "Gain", 0, 0)]
        facts = [
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 50.0,
                       "file.xlsx", "IS", "FY20", "Gain on asset", "custom:GA"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 30.0,
                       "file.xlsx", "IS", "FY20", "Gain on biz", "custom:GB"),
        ]
        _, audit, _ = consolidate(facts, rows)
        a = audit[0]
        assert a.source_method == "summed_within_file"
        assert "custom:GA" in a.derivation_formula
        assert "custom:GB" in a.derivation_formula
        assert "SUM" in a.derivation_formula

    # ── Subtotal detection (Priority A: master concept) ───────────────

    def test_master_concept_preferred_over_components(self):
        """When the master concept is present alongside segment components,
        use only the master concept value (no double-counting)."""
        rows = [MasterRow("income_statement", "us-gaap:Rev", "us-gaap:Rev",
                          "Revenue, Net", 0, 0)]
        facts = [
            MappedFact("income_statement", "us-gaap:Rev", "Revenue, Net",
                       _p("1Q17"), 153.66, "file.xlsx", "IS", "1Q17",
                       "Transactional-based revenue", "fico:TransRev"),
            MappedFact("income_statement", "us-gaap:Rev", "Revenue, Net",
                       _p("1Q17"), 43.543, "file.xlsx", "IS", "1Q17",
                       "Technology Services Revenue", "us-gaap:TechRev"),
            MappedFact("income_statement", "us-gaap:Rev", "Revenue, Net",
                       _p("1Q17"), 22.397, "file.xlsx", "IS", "1Q17",
                       "Licenses Revenue", "us-gaap:LicRev"),
            MappedFact("income_statement", "us-gaap:Rev", "Revenue, Net",
                       _p("1Q17"), 219.6, "file.xlsx", "IS", "1Q17",
                       "Revenue, Net", "us-gaap:Rev"),
        ]
        data, audit, _ = consolidate(facts, rows)
        assert data["income_statement"]["us-gaap:Rev"]["1Q17"] == 219.6
        assert audit[0].source_method != "summed_within_file"

    def test_master_concept_cost_side(self):
        """Same logic applies to cost breakdowns — use the subtotal."""
        rows = [MasterRow("income_statement", "us-gaap:CostOfRev",
                          "us-gaap:CostOfRev", "Cost of Revenue", 0, 0)]
        facts = [
            MappedFact("income_statement", "us-gaap:CostOfRev", "Cost of Revenue",
                       _p("FY20"), 200.0, "file.xlsx", "IS", "FY20",
                       "Cost - Product", "custom:CostProd"),
            MappedFact("income_statement", "us-gaap:CostOfRev", "Cost of Revenue",
                       _p("FY20"), 100.0, "file.xlsx", "IS", "FY20",
                       "Cost - Service", "custom:CostSvc"),
            MappedFact("income_statement", "us-gaap:CostOfRev", "Cost of Revenue",
                       _p("FY20"), 300.0, "file.xlsx", "IS", "FY20",
                       "Cost of Revenue", "us-gaap:CostOfRev"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["us-gaap:CostOfRev"]["FY20"] == 300.0

    # ── Subtotal detection (Priority B: implicit subtotal) ────────────

    def test_implicit_subtotal_detected(self):
        """One value equals sum of the rest → treat as subtotal, not sum."""
        rows = [MasterRow("income_statement", "X", "X", "Total", 0, 0)]
        facts = [
            MappedFact("income_statement", "X", "Total", _p("FY20"), 30.0,
                       "file.xlsx", "IS", "FY20", "Part A", "custom:A"),
            MappedFact("income_statement", "X", "Total", _p("FY20"), 50.0,
                       "file.xlsx", "IS", "FY20", "Part B", "custom:B"),
            MappedFact("income_statement", "X", "Total", _p("FY20"), 80.0,
                       "file.xlsx", "IS", "FY20", "Total line", "custom:Total"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["X"]["FY20"] == 80.0

    def test_implicit_subtotal_with_rounding(self):
        """Subtotal detection tolerates small rounding differences."""
        rows = [MasterRow("income_statement", "X", "X", "Total", 0, 0)]
        facts = [
            MappedFact("income_statement", "X", "Total", _p("FY20"), 30.3,
                       "file.xlsx", "IS", "FY20", "A", "custom:A"),
            MappedFact("income_statement", "X", "Total", _p("FY20"), 50.1,
                       "file.xlsx", "IS", "FY20", "B", "custom:B"),
            MappedFact("income_statement", "X", "Total", _p("FY20"), 80.0,
                       "file.xlsx", "IS", "FY20", "Tot", "custom:T"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["X"]["FY20"] == 80.0

    # ── Genuine sub-components still summed (Priority C) ──────────────

    def test_no_subtotal_no_master_sums(self):
        """When no subtotal or master concept exists, sum as before."""
        rows = [MasterRow("income_statement", "G", "G", "Gain", 0, 0)]
        facts = [
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 50.0,
                       "file.xlsx", "IS", "FY20", "Gain A", "custom:GA"),
            MappedFact("income_statement", "G", "Gain", _p("FY20"), 30.0,
                       "file.xlsx", "IS", "FY20", "Gain B", "custom:GB"),
        ]
        data, _, _ = consolidate(facts, rows)
        assert data["income_statement"]["G"]["FY20"] == 80.0


# ===========================================================================
# Interest expense net of interest income
# ===========================================================================

class TestInterestNetting:
    def test_net_interest_expense_minus_income_same_file(self):
        """Separate expense + income legs on the net-interest row → expense − income."""
        rows = [
            MasterRow(
                "income_statement", "us-gaap:InterestExpense",
                "us-gaap:InterestExpense", "Interest expense", 0, 0,
            ),
        ]
        facts = [
            MappedFact(
                "income_statement", "us-gaap:InterestExpense", "Interest expense",
                _p("FY20"), 100.0, "file.xlsx", "IS", "FY20", "Interest expense",
                "us-gaap:InterestExpense",
            ),
            MappedFact(
                "income_statement", "us-gaap:InterestExpense", "Interest expense",
                _p("FY20"), 25.0, "file.xlsx", "IS", "FY20", "Interest income",
                "us-gaap:InterestIncome",
            ),
        ]
        data, audit, _ = consolidate(facts, rows)
        assert data["income_statement"]["us-gaap:InterestExpense"]["FY20"] == 75.0
        assert len(audit) == 1
        assert audit[0].source_method == "interest_net"
        assert "expense_sum=100" in audit[0].derivation_formula
        assert "income_sum=25" in audit[0].derivation_formula

    def test_apply_interest_netting_aliases_maps_both_legs(self):
        from interest_netting import apply_interest_netting_aliases, find_net_interest_canonical_row

        rows = [
            MasterRow(
                "income_statement", "us-gaap:InterestExpense",
                "us-gaap:InterestExpense", "Interest expense", 0, 0,
            ),
        ]
        f1 = _fact(concept="us-gaap:InterestExpense", value=1.0)
        f2 = _fact(concept="us-gaap:InterestIncome", value=2.0)
        sheet = _sheet([f1, f2], stmt="income_statement")
        wb = _wb([sheet])
        cmap: list = []
        n = apply_interest_netting_aliases(rows, cmap, [wb])
        assert n == 2
        assert find_net_interest_canonical_row(rows) == "us-gaap:InterestExpense"
        by_raw = {(m.statement_type, m.raw_concept): m for m in cmap}
        assert by_raw[("income_statement", "us-gaap:InterestExpense")].canonical_row_id == (
            "us-gaap:InterestExpense"
        )
        assert by_raw[("income_statement", "us-gaap:InterestIncome")].canonical_row_id == (
            "us-gaap:InterestExpense"
        )
        assert by_raw[("income_statement", "us-gaap:InterestExpense")].mapping_status == (
            "interest_net_alias"
        )


# ===========================================================================
# Audit trail
# ===========================================================================

class TestFinalRawReconcile:
    def test_collect_raw_line_items_unions_row_order_and_facts(self):
        f1 = _fact("us-gaap:Cash", stmt="balance_sheet", plabel="FY20", value=1.0)
        f2 = _fact("us-gaap:OnlyInFacts", stmt="balance_sheet", plabel="FY20", value=2.0)
        sh = _sheet([f1, f2], stmt="balance_sheet", sheet_name="Balance Sheet")
        # Simulate row_order listing an extra tag not in _sheet's order from facts alone
        sh.row_order = list(sh.row_order) + ["us-gaap:OnlyOnOrder"]
        wb = _wb([sh])
        keys = collect_all_raw_xbrl_line_items([wb])
        assert ("balance_sheet", "us-gaap:Cash") in keys
        assert ("balance_sheet", "us-gaap:OnlyInFacts") in keys
        assert ("balance_sheet", "us-gaap:OnlyOnOrder") in keys

    def test_reconcile_recover_orphan_mapping(self):
        """Map points to canon with no MasterRow — reconcile adds the row."""
        from consolidator import ConsolidatedData

        p = parse_period("FY20")
        assert p is not None
        f1 = FactRecord(
            "balance_sheet", "us-gaap:OrphanTag", "Orphan line", p, 99.0,
            "f.xlsx", "BS", "FY20", 0,
        )
        sh = SheetData(
            source_file="f.xlsx",
            source_sheet="BS",
            statement_type="balance_sheet",
            facts=[f1],
            row_order=["us-gaap:OrphanTag"],
            concept_to_line={"us-gaap:OrphanTag": "Orphan line"},
            concept_to_depth={"us-gaap:OrphanTag": 0},
        )
        wb = WorkbookInfo(
            filename="f.xlsx", filepath=Path("f.xlsx"),
            is_10k=True, latest_fy=2020, sheets=[sh],
        )
        master_rows = [
            MasterRow("balance_sheet", "us-gaap:Cash", "us-gaap:Cash", "Cash", 0, 0),
        ]
        cmap = [
            ConceptMapping(
                "balance_sheet", "us-gaap:OrphanTag", "us-gaap:OrphanTag",
                "auto_from_master", "synthetic orphan for test",
            ),
        ]
        consolidated: ConsolidatedData = {"balance_sheet": {"us-gaap:Cash": {"FY20": 1.0}}}
        audit: list = []
        res = reconcile_final_statements_with_raw_xbrl(
            [wb], master_rows, cmap, consolidated, {"f.xlsx": 0}, audit,
        )
        assert res.orphan_master_rows_recovered == 1
        assert any(r.canonical_row_id == "us-gaap:OrphanTag" for r in master_rows)
        assert consolidated["balance_sheet"]["us-gaap:OrphanTag"]["FY20"] == 99.0


class TestRowOrderRegistry:
    """Concepts on the Excel row list must register even when no facts load."""

    def test_registers_concepts_with_no_loaded_facts(self):
        p = parse_period("FY20")
        assert p is not None
        f1 = FactRecord(
            "balance_sheet", "us-gaap:Cash", "Cash", p, 1.0,
            "f.xlsx", "BS", "FY20", 0,
        )
        sh = SheetData(
            source_file="f.xlsx",
            source_sheet="BS",
            statement_type="balance_sheet",
            facts=[f1],
            row_order=["us-gaap:Cash", "us-gaap:FiniteLivedIntangibleAssetsNet"],
            concept_to_line={
                "us-gaap:Cash": "Cash",
                "us-gaap:FiniteLivedIntangibleAssetsNet": "Intangibles, net",
            },
            concept_to_depth={
                "us-gaap:Cash": 0,
                "us-gaap:FiniteLivedIntangibleAssetsNet": 0,
            },
        )
        wb = WorkbookInfo(
            filename="f.xlsx", filepath=Path("f.xlsx"),
            is_10k=True, latest_fy=2020, sheets=[sh],
        )
        master_rows = [
            MasterRow("balance_sheet", "us-gaap:Cash", "us-gaap:Cash", "Cash", 0, 0),
        ]
        cmap = [
            ConceptMapping(
                "balance_sheet", "us-gaap:Cash", "us-gaap:Cash",
                "auto_from_master", "",
            ),
        ]
        n = register_row_order_concepts_not_in_map([wb], master_rows, cmap)
        assert n == 1
        assert "us-gaap:FiniteLivedIntangibleAssetsNet" in {r.canonical_row_id for r in master_rows}
        m_int = [m for m in cmap if m.raw_concept == "us-gaap:FiniteLivedIntangibleAssetsNet"]
        assert len(m_int) == 1
        assert m_int[0].mapping_status == "row_order_registry"


class TestFullMasterPresentationInExports:
    """Rows on the master 10-K presentation must appear even with no facts."""

    def test_models_json_hides_periods_before_2017(self):
        from main import _models_json, DISPLAY_MODEL_MIN_FISCAL_YEAR

        assert DISPLAY_MODEL_MIN_FISCAL_YEAR == 2017
        consolidated = {
            "income_statement": {
                "us-gaap:Revenue": {
                    "FY15": 100.0,
                    "FY16": 110.0,
                    "FY17": 120.0,
                    "1Q17": 30.0,
                },
            },
        }
        rows = [
            MasterRow("income_statement", "us-gaap:Revenue", "us-gaap:Revenue", "Revenue", 0, 0),
        ]
        models = _models_json(consolidated, rows, None)
        ann = models["income_statement"]["annual"]["periods"]
        qtr = models["income_statement"]["quarterly"]["periods"]
        assert "FY15" not in ann and "FY16" not in ann
        assert "FY17" in ann
        assert "1Q17" in qtr
        r = models["income_statement"]["annual"]["rows"][0]
        assert r.get("FY15") is None and r.get("FY16") is None
        assert r.get("FY17") == 120.0

    def test_models_json_includes_master_rows_without_consolidated_cells(self):
        from main import _models_json
        from master_presentation_builder import MasterRow

        consolidated = {
            "balance_sheet": {
                "us-gaap:Cash": {"FY20": 100.0},
            }
        }
        rows = [
            MasterRow("balance_sheet", "us-gaap:Cash", "us-gaap:Cash", "Cash", 0, 0),
            MasterRow(
                "balance_sheet",
                "us-gaap:FiniteLivedIntangibleAssetsNet",
                "us-gaap:FiniteLivedIntangibleAssetsNet",
                "Intangibles",
                1,
                0,
            ),
        ]
        models = _models_json(consolidated, rows, None)
        bs_a = models["balance_sheet"]["annual"]["rows"]
        concepts = [r["concept"] for r in bs_a]
        assert "us-gaap:FiniteLivedIntangibleAssetsNet" in concepts
        int_row = next(
            r for r in bs_a
            if r["concept"] == "us-gaap:FiniteLivedIntangibleAssetsNet"
        )
        assert int_row.get("FY20") is None

    def test_exporter_row_order_includes_master_without_data(self):
        from exporter import _row_order
        from master_presentation_builder import MasterRow

        master_rows = [
            MasterRow("balance_sheet", "us-gaap:A", "us-gaap:A", "A", 0, 0),
            MasterRow("balance_sheet", "us-gaap:B", "us-gaap:B", "B", 1, 0),
        ]
        concepts = {"us-gaap:A": {"FY20": 1.0}}
        order = _row_order(master_rows, "balance_sheet", concepts)
        assert order == ["us-gaap:A", "us-gaap:B"]


class TestAuditTrail:
    def test_reported_entry(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        facts = [MappedFact("income_statement", "R", "Revenue", _p("FY15"), 100.0,
                            "f.xlsx", "IS", "FY15", "Revenue", "R")]
        _, audit, _ = consolidate(facts, rows)
        assert len(audit) == 1
        assert audit[0].source_method == "reported"
        assert audit[0].raw_concept == "R"

    def test_derived_entry(self):
        rows = [MasterRow("income_statement", "R", "R", "Revenue", 0, 0)]
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0, "FY15": 500.0}}}
        da = derive_quarters(data, rows, [])
        derived = [a for a in da if a.source_method == "derived"]
        assert len(derived) == 1
        assert "FY15" in derived[0].derivation_formula


# ===========================================================================
# Validation
# ===========================================================================

class TestValidation:
    def test_q_sum_pass(self):
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0,
                                           "4Q15": 170.0, "FY15": 500.0}}}
        res, failures = validate_all(data)
        q_checks = [r for r in res if r.check == "Q_SUM"]
        assert len(q_checks) == 1
        assert q_checks[0].passed

    def test_q_sum_fail(self):
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0,
                                           "4Q15": 999.0, "FY15": 500.0}}}
        res, failures = validate_all(data)
        q_checks = [r for r in res if r.check == "Q_SUM"]
        assert len(q_checks) == 1
        assert not q_checks[0].passed
        assert ("income_statement", "R", "FY15") in failures

    def test_bs_equation_pass(self):
        rows = [
            MasterRow("balance_sheet", "us-gaap:Assets", "us-gaap:Assets", "Total Assets", 0, 0),
            MasterRow("balance_sheet", "us-gaap:Liabilities", "us-gaap:Liabilities", "Total Liabilities", 1, 0),
            MasterRow("balance_sheet", "us-gaap:StockholdersEquity", "us-gaap:StockholdersEquity", "Total Equity", 2, 0),
        ]
        data = {"balance_sheet": {
            "us-gaap:Assets": {"FY15": 1000.0},
            "us-gaap:Liabilities": {"FY15": 600.0},
            "us-gaap:StockholdersEquity": {"FY15": 400.0},
        }}
        res, failures = validate_all(data, rows)
        eq_checks = [r for r in res if r.check == "BS_EQUATION"]
        assert len(eq_checks) >= 1
        assert all(r.passed for r in eq_checks)

    def test_bs_equation_fail(self):
        rows = [
            MasterRow("balance_sheet", "us-gaap:Assets", "us-gaap:Assets", "Total Assets", 0, 0),
            MasterRow("balance_sheet", "us-gaap:Liabilities", "us-gaap:Liabilities", "Total Liabilities", 1, 0),
            MasterRow("balance_sheet", "us-gaap:StockholdersEquity", "us-gaap:StockholdersEquity", "Total Equity", 2, 0),
        ]
        data = {"balance_sheet": {
            "us-gaap:Assets": {"FY15": 1000.0},
            "us-gaap:Liabilities": {"FY15": 600.0},
            "us-gaap:StockholdersEquity": {"FY15": 300.0},
        }}
        res, failures = validate_all(data, rows)
        eq_checks = [r for r in res if r.check == "BS_EQUATION"]
        assert any(not r.passed for r in eq_checks)
        assert ("balance_sheet", "us-gaap:Assets", "FY15") in failures

    def test_cf_section_subtotal_pass(self):
        rows = [
            MasterRow("cash_flow", "us-gaap:NetIncomeLoss", "us-gaap:NetIncomeLoss", "Net income", 0, 0),
            MasterRow("cash_flow", "us-gaap:DA", "us-gaap:DA", "D&A", 1, 0),
            MasterRow("cash_flow", "us-gaap:NetCashProvidedByUsedInOperatingActivities",
                      "us-gaap:NetCashProvidedByUsedInOperatingActivities",
                      "Cash from operations", 2, 0),
        ]
        data = {"cash_flow": {
            "us-gaap:NetIncomeLoss": {"FY15": 100.0},
            "us-gaap:DA": {"FY15": 50.0},
            "us-gaap:NetCashProvidedByUsedInOperatingActivities": {"FY15": 150.0},
        }}
        res, failures = validate_all(data, rows)
        cf_checks = [r for r in res if "CF_SECTION" in r.check]
        assert len(cf_checks) >= 1
        assert all(r.passed for r in cf_checks)

    def test_cf_section_subtotal_fail(self):
        rows = [
            MasterRow("cash_flow", "us-gaap:NetIncomeLoss", "us-gaap:NetIncomeLoss", "Net income", 0, 0),
            MasterRow("cash_flow", "us-gaap:DA", "us-gaap:DA", "D&A", 1, 0),
            MasterRow("cash_flow", "us-gaap:NetCashProvidedByUsedInOperatingActivities",
                      "us-gaap:NetCashProvidedByUsedInOperatingActivities",
                      "Cash from operations", 2, 0),
        ]
        data = {"cash_flow": {
            "us-gaap:NetIncomeLoss": {"FY15": 100.0},
            "us-gaap:DA": {"FY15": 50.0},
            "us-gaap:NetCashProvidedByUsedInOperatingActivities": {"FY15": 200.0},
        }}
        res, failures = validate_all(data, rows)
        cf_checks = [r for r in res if "CF_SECTION" in r.check]
        assert any(not r.passed for r in cf_checks)

    def test_q_sum_cf_pass(self):
        """Q sum check works for cash flow too."""
        data = {"cash_flow": {"C": {"1Q15": 10.0, "2Q15": 20.0, "3Q15": 30.0,
                                     "4Q15": 40.0, "FY15": 100.0}}}
        res, _ = validate_all(data)
        assert all(r.passed for r in res if r.check == "Q_SUM")

    def test_failures_dict_has_all_periods(self):
        """A Q_SUM failure marks all 5 period cells (Q1-Q4 + FY) for the row."""
        data = {"income_statement": {"R": {"1Q15": 100.0, "2Q15": 110.0, "3Q15": 120.0,
                                           "4Q15": 999.0, "FY15": 500.0}}}
        _, failures = validate_all(data)
        for q in ["1Q15", "2Q15", "3Q15", "4Q15", "FY15"]:
            assert ("income_statement", "R", q) in failures


# ===========================================================================
# AI matcher – unit tests (mocked, no real API calls)
# ===========================================================================

from unittest.mock import patch, MagicMock
from ai_matcher import (
    ai_match_concepts, UnmatchedConcept, AiMatchResult,
    _build_prompt, _parse_ai_response,
)


class TestAiMatcherHelpers:
    def test_build_prompt_contains_master_and_unmatched(self):
        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:Revenue",
                     "display_label": "Revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:COGS", "Cost of goods sold")]
        prompt = _build_prompt(masters, unmatched)
        assert "us-gaap:Revenue" in prompt
        assert "custom:COGS" in prompt
        assert "Cost of goods sold" in prompt

    def test_parse_ai_response_plain_json(self):
        raw = '{"income_statement||custom:COGS": "us-gaap:CostOfRevenue"}'
        result = _parse_ai_response(raw)
        assert result["income_statement||custom:COGS"] == "us-gaap:CostOfRevenue"

    def test_parse_ai_response_markdown_fenced(self):
        raw = '```json\n{"income_statement||custom:COGS": "us-gaap:CostOfRevenue"}\n```'
        result = _parse_ai_response(raw)
        assert result["income_statement||custom:COGS"] == "us-gaap:CostOfRevenue"

    def test_parse_ai_response_with_nulls(self):
        raw = '{"income_statement||custom:X": null, "income_statement||custom:Y": "us-gaap:Z"}'
        result = _parse_ai_response(raw)
        assert result["income_statement||custom:X"] is None
        assert result["income_statement||custom:Y"] == "us-gaap:Z"


class TestAiMatchConcepts:
    def test_no_api_key_returns_all_none(self):
        """Without an API key, all items remain unmatched."""
        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:Revenue",
                     "display_label": "Revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:COGS", "Cost of goods sold")]
        results = ai_match_concepts(masters, unmatched, provider="openai", api_key="")
        assert len(results) == 1
        assert results[0].canonical_row_id is None

    def test_empty_unmatched_returns_empty(self):
        results = ai_match_concepts([], [], provider="openai", api_key="fake")
        assert results == []

    @patch("ai_matcher._call_llm")
    def test_successful_ai_match(self, mock_llm):
        mock_llm.return_value = '{"income_statement||custom:COGS": "us-gaap:CostOfRevenue"}'

        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:CostOfRevenue",
                     "display_label": "Cost of revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:COGS", "Cost of goods sold")]

        results = ai_match_concepts(masters, unmatched, provider="openai", api_key="fake-key")
        assert len(results) == 1
        assert results[0].canonical_row_id == "us-gaap:CostOfRevenue"

    @patch("ai_matcher._call_llm")
    def test_ai_returns_null_for_uncertain(self, mock_llm):
        mock_llm.return_value = '{"income_statement||custom:WeirdLine": null}'

        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:Revenue",
                     "display_label": "Revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:WeirdLine", "Some weird item")]

        results = ai_match_concepts(masters, unmatched, provider="openai", api_key="fake-key")
        assert results[0].canonical_row_id is None

    @patch("ai_matcher._call_llm")
    def test_ai_invalid_canonical_id_rejected(self, mock_llm):
        """AI returning a canonical_row_id that doesn't exist in master is rejected."""
        mock_llm.return_value = '{"income_statement||custom:COGS": "us-gaap:INVENTED"}'

        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:Revenue",
                     "display_label": "Revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:COGS", "Cost of goods")]

        results = ai_match_concepts(masters, unmatched, provider="openai", api_key="fake-key")
        assert results[0].canonical_row_id is None

    @patch("ai_matcher._call_llm")
    def test_ai_error_returns_all_none(self, mock_llm):
        """If AI call throws, everything stays unmatched — pipeline continues."""
        mock_llm.side_effect = Exception("API timeout")

        masters = [{"statement_type": "income_statement",
                     "canonical_row_id": "us-gaap:Revenue",
                     "display_label": "Revenue"}]
        unmatched = [UnmatchedConcept("income_statement", "custom:COGS", "COGS")]

        results = ai_match_concepts(masters, unmatched, provider="openai", api_key="fake-key")
        assert len(results) == 1
        assert results[0].canonical_row_id is None


class TestPhase3Integration:
    """Test that AI matching integrates into build_master_presentation."""

    @patch("ai_matcher.ai_match_concepts")
    def test_ai_match_folds_into_concept_map(self, mock_ai):
        """AI-matched concepts map to existing master rows instead of creating new ones."""
        mock_ai.return_value = [
            AiMatchResult("income_statement", "custom:COGS", "us-gaap:Revenue"),
        ]

        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:COGS", line="Cost of goods sold", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, cmap = build_master_presentation(
            master_wb, all_workbooks=[master_wb, old_wb],
            ai_provider="openai", ai_api_key="fake",
        )

        assert len(rows) == 1
        ai_maps = [m for m in cmap if m.mapping_status == "ai_matched"]
        assert len(ai_maps) == 1
        assert ai_maps[0].raw_concept == "custom:COGS"
        assert ai_maps[0].canonical_row_id == "us-gaap:Revenue"

    @patch("ai_matcher.ai_match_concepts")
    def test_ai_null_creates_new_row(self, mock_ai):
        """Concepts the AI can't match still become new rows."""
        mock_ai.return_value = [
            AiMatchResult("income_statement", "custom:Mystery", None),
        ]

        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:Mystery", line="Mystery item", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, cmap = build_master_presentation(
            master_wb, all_workbooks=[master_wb, old_wb],
            ai_provider="openai", ai_api_key="fake",
        )

        assert len(rows) == 2
        filing_maps = [m for m in cmap if m.mapping_status == "auto_from_filing"]
        assert len(filing_maps) == 1

    def test_no_ai_provider_skips_phase3(self):
        """Without ai_provider, Phase 3 is skipped entirely — no AI call."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:COGS", line="Cost of goods sold", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, cmap = build_master_presentation(
            master_wb, all_workbooks=[master_wb, old_wb],
        )

        assert len(rows) == 2
        assert not any(m.mapping_status == "ai_matched" for m in cmap)

    @patch("ai_matcher.ai_match_concepts", side_effect=Exception("boom"))
    def test_ai_failure_falls_back_gracefully(self, mock_ai):
        """If AI fails, pipeline continues — unmatched items become new rows."""
        master_sh = _sheet([_fact("us-gaap:Revenue", line="Revenue")])
        master_wb = _wb([master_sh], "10-K.xlsx", True, 2024)

        old_sh = _sheet([
            _fact("custom:COGS", line="COGS", src="old.xlsx"),
        ], src="old.xlsx")
        old_wb = _wb([old_sh], "old.xlsx", False, 2018)

        rows, cmap = build_master_presentation(
            master_wb, all_workbooks=[master_wb, old_wb],
            ai_provider="openai", ai_api_key="fake",
        )

        assert len(rows) == 2
        assert any(m.mapping_status == "auto_from_filing" for m in cmap)


# ===========================================================================
# Coverage pass
# ===========================================================================

class TestCoveragePass:
    def test_repair_mapped_gap_fills_missing_cell(self):
        from coverage_pass import repair_mapped_gaps
        from row_mapper import MappedFact

        consolidated = {"income_statement": {"us-gaap:Revenue": {"FY15": None}}}
        mf = MappedFact(
            statement_type="income_statement",
            canonical_row_id="us-gaap:Revenue",
            display_label="Revenue",
            period=_p("FY15"),
            value=123.0,
            source_file="a.xlsx",
            source_sheet="Income Statement",
            source_column="FY15",
            raw_line_label="Revenue",
            raw_concept="us-gaap:Revenue",
        )
        rows = [
            MasterRow("income_statement", "us-gaap:Revenue", "us-gaap:Revenue", "Revenue", 0, 0),
        ]
        audit: list = []
        n = repair_mapped_gaps(consolidated, [mf], {"a.xlsx": 1}, rows, audit)
        assert n == 1
        assert consolidated["income_statement"]["us-gaap:Revenue"]["FY15"] == 123.0
        assert any(a.source_method == "coverage_repair" for a in audit)

    def test_integrate_unresolved_positions_and_fills(self):
        from coverage_pass import integrate_unresolved_facts
        from row_mapper import UnresolvedRow

        sh = _sheet([
            _fact("us-gaap:Revenue", value=1.0, plabel="FY15"),
            _fact("custom:OrphanConcept", value=50.0, line="Orphan line", plabel="FY15"),
        ])
        wb = _wb([sh], "f.xlsx", False, 2015)
        wbs = [wb]
        rows = [
            MasterRow("income_statement", "us-gaap:Revenue", "us-gaap:Revenue", "Revenue", 0, 0),
        ]
        cmap = [
            ConceptMapping(
                "income_statement", "us-gaap:Revenue", "us-gaap:Revenue",
                "auto_from_master", "",
            ),
        ]
        consolidated: dict = {"income_statement": {"us-gaap:Revenue": {"FY15": 1.0}}}
        unresolved = [
            UnresolvedRow(
                source_file="f.xlsx",
                source_sheet="Income Statement",
                line_label="Orphan line",
                concept="custom:OrphanConcept",
                period_label="FY15",
                value=50.0,
                reason="Concept not in concept_to_row_map",
                statement_type="income_statement",
            ),
        ]
        audit: list = []
        rem, nrows, ncells = integrate_unresolved_facts(
            wbs, rows, cmap, consolidated, {"f.xlsx": 1}, unresolved, audit,
        )
        assert nrows == 1
        assert ncells == 1
        assert not rem
        assert consolidated["income_statement"]["custom:OrphanConcept"]["FY15"] == 50.0
        assert any(m.mapping_status == "coverage_integrated" for m in cmap)
        assert any(r.canonical_row_id == "custom:OrphanConcept" for r in rows)


# ===========================================================================
# Explicit workbook coverage (no dropped line items)
# ===========================================================================

class TestExplicitWorkbookCoverage:
    def test_integrate_concept_present_in_workbook_but_not_in_map(self):
        from coverage_pass import (
            _group_facts_by_statement_concept,
            integrate_workbook_concepts_not_in_map,
        )

        sh = _sheet([
            _fact("us-gaap:Revenue", value=1.0, plabel="FY15"),
            _fact("us-gaap:InterestIncome", value=7.5, line="Interest income", plabel="FY15"),
        ])
        wb = _wb([sh], "extra.xlsx", False, 2015)
        workbooks = [wb]
        groups = _group_facts_by_statement_concept(workbooks)
        rows = [
            MasterRow("income_statement", "us-gaap:Revenue", "us-gaap:Revenue", "Revenue", 0, 0),
        ]
        cmap = [
            ConceptMapping(
                "income_statement", "us-gaap:Revenue", "us-gaap:Revenue",
                "auto_from_master", "",
            ),
        ]
        consolidated: dict = {"income_statement": {"us-gaap:Revenue": {"FY15": 1.0}}}
        audit: list = []
        nr, nc = integrate_workbook_concepts_not_in_map(
            groups,
            workbooks,
            rows,
            cmap,
            consolidated,
            {"extra.xlsx": 1},
            audit,
        )
        assert nr == 1
        assert nc >= 1
        assert consolidated["income_statement"]["us-gaap:InterestIncome"]["FY15"] == 7.5
        assert any(m.mapping_status == "explicit_workbook_line" for m in cmap)

    def test_fill_empty_cell_from_workbook_scan(self):
        from coverage_pass import (
            _group_facts_by_statement_concept,
            fill_consolidated_gaps_from_workbook_groups,
        )

        sh = _sheet([_fact("us-gaap:Revenue", value=42.0, plabel="FY15")])
        wb = _wb([sh], "f.xlsx", False, 2015)
        groups = _group_facts_by_statement_concept([wb])
        rows = [MasterRow("income_statement", "us-gaap:Revenue", "us-gaap:Revenue", "R", 0, 0)]
        cmap = [
            ConceptMapping(
                "income_statement", "us-gaap:Revenue", "us-gaap:Revenue",
                "auto_from_master", "",
            ),
        ]
        consolidated = {"income_statement": {"us-gaap:Revenue": {}}}
        audit: list = []
        n = fill_consolidated_gaps_from_workbook_groups(
            groups, cmap, consolidated, {"f.xlsx": 1}, rows, audit,
        )
        assert n == 1
        assert consolidated["income_statement"]["us-gaap:Revenue"]["FY15"] == 42.0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
