# 30-Company Compilation Audit (seed 20260614)

**Output:** `scripts/.compile-audit-30/` (report + `manifest.json`)  
**Workbooks:** `scripts/.sample-compile-pack/{TICKER}/`

## Tickers (30)

MSFT, BRK.B, HD, V, META, AAPL, UNH, AMZN, JPM, PEP, TXN, AVGO, SPGI, INTU, TMO, MCD, AMGN, QCOM, DECK, EMR, ETN, BIO, GNRC, MANH, SPSC, PDFS, ZD, ATEN, MODG, CABO

## Results

| Metric | Count |
|--------|-------|
| Compiled OK | **28 / 30** |
| Workbook-truth mismatches | **0** (all 28 successful compiles) |
| Fully empty Excel period columns | **0** |

---

## Failures (2 tickers)

### MSFT — batch `compileOk=false`

**Evidence:** `filingsFailed=5`, `filingsSaved=25`; log shows `EBUSY: resource busy or locked` on five 10-Q saves.

**Exact cause:** Windows file lock during `writeFile` to `MSFT/in/` (another process holding `.xlsx` open — Excel, antivirus, or concurrent read of the same path). Batch then invoked the compiler with only 25 workbooks; Python exited non-zero and stderr INFO lines were captured as the error string.

**Verified:** Re-compiling current `MSFT/in/` (**35 workbooks**) returns `ok: true`, `workbook_truth.issues_count: 0`.

**Low-risk fixes:**
- Write to a temp file, then `rename` into `in/`
- Skip re-download when `in/` already has ≥28 workbooks; run compile-only
- Treat compiler stderr INFO separately from failure when `consolidated_historical_financials.xlsx` exists

### MODG — no compile

**Evidence:** `error: ticker not in SEC cache`, `filingsSaved=0`.

**Exact cause:** `getAllFilingsByTickerCached("MODG")` returns null — ticker absent from local SEC submissions cache (`scripts/compile-sample-pack.ts` line 165–171).

**Low-risk fix:** Refresh SEC cache build, or filter sample pool to tickers present in cache before bulk run.

---

## Issue class A — YTD (6M/9M) not in Excel (18 tickers flagged)

**What the audit flagged:** `xbrl_backed_periods_by_statement` lists `6M20`/`9M20` etc., but no `IS_YTD`/`CF_YTD` columns (or specific YTD keys missing).

**Exact cause (traced on HD, confirmed on V):**

1. **Loader** has YTD facts (e.g. HD IS: `6M20` × 17 facts across workbooks).
2. **Headline filter** (`headline_periods.py`): a 10-Q only headlines `6M` when its **newest quarter is Q2** (same FY), and `9M` when newest is **Q3**. Example — HD file headlining `3Q21` contains `6M20` as a **comparative** column → `6M20 ∉ headlines`.
3. **Consolidator** (`consolidator.py` Stage 2, `strict_headlines=True`): cells are kept **only** from files that headline that period. Non-headline YTD comparatives are dropped by design.
4. **Audit trail** for HD IS/CF: **zero** `6M*`/`9M*` entries → nothing for `_ytd_periods()` to export.
5. **`xbrl_backed_periods`** counts loader-level facts (including comparatives); export uses **consolidated** values only → metric mismatch, not an exporter regression.

**Low-risk fixes:**
- **Document** that YTD Excel columns only appear when YTD periods survive headline-only consolidation (typically Q2/Q3 primary filings for that FY).
- **Optional (low risk):** Add compile JSON field `consolidated_periods_by_statement` distinct from `xbrl_backed_periods` so audits compare the right layers.
- **Higher scope (not low risk):** Relax headline rule for YTD when a filing’s face column is natively labeled 6M/9M for the reported quarter (requires per-column headline, not file-level newest quarter).

---

## Issue class B — Sparse columns (18 instances, 11 tickers)

### B1 — Matches source (13 instances)

**Evidence:** Compiled fill ratio equals source workbook column fill (e.g. JPM BS `1Q21`: compiled `16/141`, source `16/16`; ETN IS `1Q22`: compiled `10/46`, source `16/16`).

**Exact cause:** `_row_order()` lists all master presentation rows; many lines have no fact for that period in the source filing. Consolidation did not drop data.

**Low-risk fix:** UI/analyst flag for columns below 25% master-row fill (display only).

### B2 — No source column (5 instances, e.g. BRK.B IS `4Q20` at `2/43`)

**Evidence:** `source_audit_trail.csv` shows only 2 rows for BRK.B IS `4Q20`, both `source_method=copied_from_fy_for_wacs` (`derivation_engine.py`).

**Exact cause:** Weighted-average share count copied from FY onto 4Q rows; no 10-Q/10-K IS column exists for `4Q20` with full line items. Sparse column is derivation artifact, not missing consolidation.

**Low-risk fix:** Document WAC copy behavior; optionally exclude `copied_from_fy_for_wacs` rows from fill-ratio alerts.

---

## Clean tickers (no issues)

META, AMZN, PEP, AVGO, INTU, MCD, DECK, MANH, CABO — plus others with only benign YTD headline gaps as above.

---

## Suggested prioritized fixes (all low-risk unless noted)

1. **Bulk download:** temp-file write + rename; compile-only when `in/` is complete; avoid reading `in/` during bulk save.
2. **Sample pool:** Validate ticker exists in SEC cache before draw.
3. **YTD expectations:** Document headline-only consolidation; split `xbrl_backed` vs `consolidated` period lists in compile JSON.
4. **Sparse columns:** Display-only low-fill warnings; exclude WAC-copy rows from alerts.
5. **MSFT:** Re-run `npx tsx scripts/compile-sample-pack.ts MSFT` with files closed → should reach 30/30.
