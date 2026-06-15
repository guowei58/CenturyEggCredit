# 50-Company Financial Statement Compilation Audit

**Seed:** 20260613  
**Generated:** 2026-06-14  
**Output folder:** `scripts/.sample-compile-pack/`

## Sample selection (50 tickers: mega / large / mid / small)

PG, XOM, NVDA, BRK.B, MSFT, UNH, WMT, AAPL, AMZN, GOOGL, JNJ, HD, JPM, V, META, NKE, PFE, BA, SPGI, TMO, MCD, KO, AMD, CAT, PM, INTU, TXN, ORCL, MRK, COST, PEGA, NXST, BIO, EMR, ETN, FICO, PH, DECK, ITW, MIDD, BLCO, GIII, SCVL, GEN, PRGS, MGRC, CALX, CEVA, PDFS, MGPI

## Artifacts saved for your review

| Path | Contents |
|------|----------|
| `{TICKER}/in/*.xlsx` | Downloaded SEC as-presented workbooks (30 filings each, except BLCO=17, ORCL=29) |
| `{TICKER}/out/` | Compiler CSV audit trail + `consolidated_historical_financials.xlsx` |
| `{TICKER}_compiled_financials.xlsx` | Copy of consolidated Excel at pack root |
| `compiled-financials-sample.zip` | All compiled workbooks + README |
| `manifest.json` | Per-ticker compile results |
| `full-audit-report.json` | Machine-readable audit (all 50 tickers) |
| `compile-50-run.log` | Full download + compile log |

---

## Executive summary

| Metric | Result |
|--------|--------|
| Batch compile success | **49 / 50** |
| Workbook-truth mismatches (49 successful compiles) | **0** |
| Fully empty period columns in Excel | **0** across all 49 outputs |
| MSFT batch failure | **1** (transient; see below) |

**Bottom line:** No evidence of consolidated values being dropped into blank Excel columns. The main “missing column” patterns are (a) **exporter design** omitting 6M/9M YTD from `*_Quarterly` sheets, and (b) **period header parsing** skipping BA (and similar) 10-Q workbooks. Sparse columns are overwhelmingly **master rows without source facts**, not silent data loss.

---

## Issue 1 — MSFT batch compile failed (1 ticker)

**Evidence:** `manifest.json` → MSFT: `compileOk=false`, `filingsSaved=25`, `filingsFailed=5` (EBUSY file locks during download while audit scripts had files open).

**Re-test:** Re-running the compiler on the current MSFT `in/` folder (35 workbooks) completes with `"ok": true` and 0 workbook-truth issues. A valid consolidated file exists at `MSFT/out/consolidated_historical_financials.xlsx` from the prior successful run.

**Root cause:** Operational file lock during parallel access, not a compiler logic defect.

**Low-risk fix:** Re-run `npx tsx scripts/compile-sample-pack.ts MSFT` in isolation; avoid reading/writing `MSFT/in` during bulk download.

---

## Issue 2 — 6M / 9M YTD columns missing from Excel (42 / 49 tickers)

**What you see:** Consolidated model has `6M20`…`9M25` periods (visible in compiler JSON `xbrl_backed_periods_by_statement`) but they do **not** appear as columns on `IS_Quarterly` / `CF_Quarterly` sheets.

**Root cause (confirmed in code):** `exporter._q_periods()` only exports periods where `period.is_quarterly() or period.is_annual()`. Cumulative YTD types (`6M`, `9M`) are excluded even when populated in the consolidated grid.

```28:37:xbrl-compiler/exporter.py
def _q_periods(concepts: dict[str, dict], *, display_min_fiscal_year: int | None = None) -> list[str]:
    ...
            if not p or not (p.is_quarterly() or p.is_annual()):
                continue
```

**Low-risk fix:** Add a small `_ytd_periods()` helper (or extend `_q_periods` to include `p.is_cumulative()`) and write a third sheet block or append YTD columns to the quarterly sheets. No consolidation logic change required.

---

## Issue 3 — FY columns on `*_Quarterly` sheets (44 / 49 tickers)

**What you see:** `FY20`…`FY25` appear on sheets named `IS_Quarterly`, `BS_Quarterly`, etc.

**Root cause:** Same `_q_periods()` includes annual (`FY`) periods. Naming is misleading but values are correct.

**Low-risk fix:** Move FY-only columns to `*_Annual` sheets exclusively, or rename sheets to `IS_Periods` / document that “Quarterly” includes FY.

---

## Issue 4 — BA (and similar filers): interim 10-Q data largely absent (1 ticker in sample)

**What you see:** BA compiles with only **FY + 4Q** style coverage. No workbook-truth errors, but **21 of 30** saved workbooks load **zero** statement sheets.

**Root cause (traced):** Boeing 10-Q exports use SEC date headers **without a comma before the year**, e.g. `Three months ended March 31 2019`. `parse_workbook_period()` returns `None` for these strings; `_find_header()` requires at least one parsable period column and skips the entire sheet.

Verified:
- `'Three months ended March 31 2019'` → **None**
- `'Three months ended March 31, 2019'` → **1Q19** ✓
- `'Six months ended June 30 2019'` → **None**
- 10-K BA workbooks parse correctly; 22/22 quarterly CF files fail header detection.

**Impact:** All IS/BS/CF facts from 10-Q filings are dropped at load time. Consolidation runs on 10-K-only facts (~1997 facts, 25 sheets from 9 workbooks).

**Low-risk fix:** Extend `period_parser._SEC_DATE_RE` (or pre-normalize headers) to accept optional comma before 4-digit year, and ensure 6M/9M prose headers map to cumulative periods. This is the same class of fix already applied for plain-year and Meta-sheet fallbacks.

---

## Issue 5 — Sparse columns (<25% cells filled) (11 / 49 tickers)

**Not the same as empty columns.** Examples:

| Ticker | Example | Compiled fill | Source fill | Verdict |
|--------|---------|---------------|-------------|---------|
| CAT | IS 3Q23 | 5/28 rows | **5/9** in headline 10-Q | Master presentation has more rows than the filing column; sparse but not missing data |
| MSFT | IS 1Q23 | 6/23 rows | **6/7** in headline 10-Q | Face extract only captured EPS block for that column; workbook-truth = 0 issues |
| PDFS / NXST / JPM | BS columns ~20–35% | N/A | Normal for BS — many lines are blank each period | Presentation sparsity, not compilation drop |
| BRK.B | IS 4Q20 | 2/43 | No matching source column found | Likely derived / consolidated-only period with minimal mapped lines |

**Root cause:** (1) Master row list includes lines with no fact for that period; (2) SEC face extract sometimes returns abbreviated columns (especially MSFT IS); (3) Balance sheets naturally sparse.

**Low-risk fix:** UI/Excel could grey out master rows with no source mapping for a period (display-only). Optional: flag columns where filled rows < 30% of master rows for analyst review.

---

## Issue 6 — Missing 2Q / 3Q quarter columns (pattern, not universal bug)

Many filers (e.g. MSFT IS) show **1Q + 4Q + 6M + 9M** in source workbooks but not **2Q / 3Q** in Excel. This reflects filing layout: middle-quarter detail is reported as YTD durations, not discrete 2Q/3Q columns. Derivation reports `Derived 0 quarterly values` when quarterization cannot be inferred safely.

**Low-risk fix:** If product needs a complete 1Q–4Q grid, derive 2Q/3Q from YTD deltas where accounting identity allows — already partially implemented in `derivation_engine.py` but conservative by design.

---

## Issue 7 — Thin filing history (2 tickers)

| Ticker | Filings saved | Notes |
|--------|---------------|-------|
| BLCO | 17 | Recent spinoff / shorter SEC history — expected shorter compiled grid |
| ORCL | 29 | One filing failed/skipped in bulk save — minor coverage gap |

---

## Workbook-truth validation

Re-compiled all 49 successful tickers via `main.py` during audit. **Zero** `missing_value`, `extra_value`, `value_mismatch`, `missing_line`, or `extra_line` issues in compiler JSON.

Headline filing cells match consolidated reported values within tolerance — the strictest check passed universally in this sample.

---

## Suggested low-risk fixes (priority order)

1. **Period parser:** Accept SEC date headers with optional comma before year (`March 31 2019` and `March 31, 2019`); map `Six/Nine months ended …` to 6M/9M. Fixes BA-class 10-Q load failures.
2. **Exporter:** Include 6M/9M in Excel output (separate section or appended columns). Fixes the most common “missing column” user report.
3. **Exporter naming:** Stop putting FY columns on `*_Quarterly` sheets or rename sheets to avoid confusion.
4. **Operational:** Serialize MSFT (or any re-download) away from concurrent file access; treat EBUSY as retryable.
5. **Display (optional):** Highlight sparse columns where fill ratio < 25% of master rows for analyst review — no pipeline change.

---

## Files to open first for manual audit

1. `BA/out/consolidated_historical_financials.xlsx` — compare quarterly coverage vs `BA/in/` 10-Q files  
2. `XOM/out/consolidated_historical_financials.xlsx` — note missing 6M/9M columns vs `source_audit_trail.csv`  
3. `MSFT/out/source_audit_trail.csv` — periods with data vs Excel column list  
4. `full-audit-report.json` — per-ticker `missing_6m_9m_in_excel`, `sparse_cols`, `workbook_truth_issues`
