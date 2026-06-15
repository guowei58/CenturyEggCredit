# HTZ compiler failure report (latest live workbooks)

Input: `C:\Users\admin\Desktop\CenturyEggCredit\scripts\.htz-live-compile\in`
Master: `HTZ_SEC-XBRL-financials_as-presented_10-K_2026-02-26_0001657853-26-000008.xlsx`
Mapped facts: 7330 | Unresolved: 0 | Conflicts: 120
Validation: 320 passed / 151 failed
Within-file SUM events: 37
Workbook truth issues: 0

## Where the compiler goes wrong (ordered by impact)

### 1. Stage 1 consolidation — `_resolve_multi_concept` sums unrelated tags on one row

**37 cells** used `summed_within_file` (Priority C in `consolidator.py` when multiple
raw concepts map to the same canonical row + period and no master/subtotal rule fires).

Top affected canonical rows:
- `income_statement|us-gaap:InterestExpenseOperating` — 12 SUM events
- `cash_flow|us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations` — 9 SUM events
- `income_statement|us-gaap:NetIncomeLoss` — 2 SUM events
- `income_statement|us-gaap:WeightedAverageNumberOfSharesOutstandingBasic` — 2 SUM events
- `income_statement|us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` — 2 SUM events
- `cash_flow|us-gaap:InterestPaidNet` — 2 SUM events
- `cash_flow|us-gaap:OtherOperatingActivitiesCashFlowStatement` — 2 SUM events
- `cash_flow|us-gaap:IncreaseDecreaseInAccruedLiabilities` — 2 SUM events
- `cash_flow|us-gaap:ProceedsFromSaleAndMaturityOfMarketableSecurities` — 1 SUM events
- `income_statement|us-gaap:Revenues` — 1 SUM events
- `income_statement|us-gaap:IncomeLossAttributableToParent` — 1 SUM events
- `income_statement|us-gaap:InterestExpenseOperating@R11` — 1 SUM events

Examples (from `source_audit_trail.csv`):

- **Vehicle** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:vehicle + html:worldwide-vehicle-rental` → 9204.0 (SUM(html:vehicle + html:worldwide-vehicle-rental) in HTZ_SEC-XBRL-financials_as-)
- **Net income (loss)** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:net-income-loss + html:net-income-loss-attributable-to-hertz-global + html:net-income-loss-from-continuing-operations` → -679.0 (SUM(html:net-income-loss + html:net-income-loss-attributable-to-hertz-global + h)
- **Basic** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:basic + html:basic-earnings-loss-per-share + html:basic-earnings-loss-per-share-from-continuing-operations` → 78.64 (SUM(html:basic + html:basic-earnings-loss-per-share + html:basic-earnings-loss-p)
- **Diluted** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:diluted + html:diluted-earnings-loss-per-share + html:diluted-earnings-loss-per-share-from-continuing-operations` → 78.64 (SUM(html:diluted + html:diluted-earnings-loss-per-share + html:diluted-earnings-)
- **Vehicle** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:depreciation-of-revenue-earning-vehicles-net + html:revenue-earning-vehicles-and-non-vehicle-capital-assets-acquired-through-capital-lease + html:sales-of-revenue-earning-vehicles-included-in-receivables + html:vehicle` → 3456.0 (SUM(html:depreciation-of-revenue-earning-vehicles-net + html:revenue-earning-veh)
- **Other** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:other + html:proceeds-from-property-and-other-equipment-disposed-of-or-to-be-disposed-of + html:sales-type-capital-lease-of-revenue-earning-vehicles-included-in-other-receivables` → 132.0 (SUM(html:other + html:proceeds-from-property-and-other-equipment-disposed-of-or-)
- **Accrued liabilities** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:accrued-liabilities + html:purchases-of-revenue-earning-vehicles-included-in-accounts-payable-and-accrued-liabilities-net-of-incentives` → 244.0 (SUM(html:accrued-liabilities + html:purchases-of-revenue-earning-vehicles-includ)
- **Sales of marketable securities** @ FY18 in `ted_10-K_2019-02-25_0001657853-19-000005.xlsx`: `html:purchases-of-marketable-securities + html:sales-of-marketable-securities` → -24.0 (SUM(html:purchases-of-marketable-securities + html:sales-of-marketable-securitie)

**Code path:** `consolidator.py` → `_resolve_multi_concept` → Priority C sum when
Priority A (master concept present), A2 (preferred revenue tag), B (subtotal detect) all miss.

### 2. Phase 2 concept mapping — fuzzy / ambiguous label match

**71 fuzzy label matches**
**64 flagged bad/ risky maps** (depreciation→Revenues, vehicle→Interest, cash rollforward, fuzzy html/htzz→us-gaap).

**Code path:** `master_presentation_builder.py` → `_scan_workbook_phase2` →
`_labels_similar_for_merge` (IS/CF) or `_resolve_norm_label_match` with multiple `vehicle` candidates (BS returns None → Phase 4 new rows).

Sample bad maps:
- `htzz:CapitalExpendituresIncurredButNotYetPaidSubjectToCompromise` → `us-gaap:InterestPaidNet` (Fuzzy label match to us-gaap:InterestPaidNet (from HTZ_SEC-XBRL-financ)
- `htzz:CapitalExpendituresAcquiredViaCapitalLeases` → `us-gaap:InterestPaidNet` (Fuzzy label match to us-gaap:InterestPaidNet (from HTZ_SEC-XBRL-financ)
- `htz:CostOfServicesDepreciationAndLeaseCharges` → `us-gaap:Revenues` (Fuzzy label match to us-gaap:Revenues (from HTZ_SEC-XBRL-financials_as)
- `html:weighted-average-shares-outstanding` → `html:weighted-average-common-shares-outstanding` (Fuzzy label match to html:weighted-average-common-shares-outstanding ()
- `html:earnings-loss-per-share` → `html:earnings-loss-per-common-share` (Fuzzy label match to html:earnings-loss-per-common-share (from HTZ_SEC)
- `html:worldwide-vehicle-rental` → `us-gaap:InterestExpenseOperating` (Fuzzy label match to us-gaap:InterestExpenseOperating (from HTZ_SEC-XB)
- `html:depreciation-of-revenue-earning-vehicles-and-lease-charges` → `us-gaap:Revenues` (Fuzzy label match to us-gaap:Revenues (from HTZ_SEC-XBRL-financials_as)
- `html:net-income-loss-attributable-to-the-hertz-corporation-and-subsidiaries-common-stockholder` → `us-gaap:NetIncomeLoss` (Fuzzy label match to us-gaap:NetIncomeLoss (from HTZ_SEC-XBRL-financia)
- `html:earnings-loss-per-share-basic-and-diluted` → `us-gaap:WeightedAverageNumberOfSharesOutstandingBasic` (Fuzzy label match to us-gaap:WeightedAverageNumberOfSharesOutstandingB)
- `html:basic-earnings-loss-per-share-in-dollars-per-share` → `us-gaap:WeightedAverageNumberOfSharesOutstandingBasic` (Fuzzy label match to us-gaap:WeightedAverageNumberOfSharesOutstandingB)
- `html:diluted-earnings-loss-per-share-in-dollars-per-share` → `us-gaap:WeightedAverageNumberOfDilutedSharesOutstanding` (Fuzzy label match to us-gaap:WeightedAverageNumberOfDilutedSharesOutst)
- `html:vehicles` → `us-gaap:InterestExpenseOperating` (Normalized label 'vehicle' matched master us-gaap:InterestExpenseOpera)
- `html:non-vehicle` → `us-gaap:InterestExpenseOperating@R10` (Normalized label 'non vehicle' matched master us-gaap:InterestExpenseO)

### 3. Namespace split — `htzz:` (10-Q) vs `htz:` (10-K master)

- Raw `htzz:` concepts in map: **40**
- Master/canonical `htz:` rows: **50**
- Local-name match fails across prefix; label match is used instead → collisions with `us-gaap:` rows.

### 4. Master presentation bloat — duplicate segment labels

**21 master rows** with display label Vehicle/Vehicles/Non-vehicle (different canonical IDs).
Phase 4 adds more `html:`/`htzz:` rows when BS label match is ambiguous.

### 5. Compiled grid gaps (Revenues example)

- {'period': '1Q23', 'value': 2047}
- {'period': '1Q24', 'value': 2080}
- {'period': '1Q25', 'value': 1813}
- {'period': '1Q26', 'value': 2004}
- {'period': '2Q24', 'value': 2353}
- {'period': '3Q24', 'value': 2576}
- {'period': 'FY23', 'value': 9371}
- {'period': 'FY24', 'value': 9049}

### 6. Validation failures

**151** checks failed (see compiler validators — roll-forwards, totals, etc.).

### 7. Workbook truth

**0** truth issues after truth loop (2 iterations).

## What is NOT the problem (on latest tagged workbooks)

- 10-Q workbooks **are** XBRL-tagged (us-gaap + htzz + some html headers)
- Not html-only label-only matching for all rows — local-name match works for us-gaap tags
- Not stale audit-truth-batch input
