# HTZ compile trace

Loaded 30 workbooks; compiled 30
Master: 10-K_2026-02-26_0001657853-26-000008.xlsx
HTML-only 10-Q count: 23
Tagged 10-K count: 7
Within-file SUM events: 89

## Missing Revenues on headline 10-Q periods (source workbook has 0 revenue facts)
- 10-Q_2023-04-27_0001657853-23-000075.xlsx headline 1Q23: NO revenue row in saved workbook
- 10-Q_2024-04-25_0001657853-24-000058.xlsx headline 1Q24: NO revenue row in saved workbook
- 10-Q_2025-05-12_0001657853-25-000057.xlsx headline 1Q25: NO revenue row in saved workbook
- 10-Q_2026-05-08_0001657853-26-000024.xlsx headline 1Q26: NO revenue row in saved workbook

## Bad concept-map collapses (verified in concept_map)
- [multiple_html_vehicle_labels_same_usgaap_row] balance_sheet us-gaap:PropertySubjectToOrAvailableForOperatingLeaseNet: ['html:total-revenue-earning-vehicles-net', 'html:revenue-earning-vehicles-net']
- [cash_rollforward_components_same_row] cash_flow us-gaap:CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsIncludingDisposalGroupAndDiscontinuedOperations: ['html:cash-and-cash-equivalents-and-restricted-cash-and-cash-equivalents-at-beginning-of-period', 'html:cash-and-cash-equivalents-and-restricted-cash-and-cash-equivalents-at-end-of-period', 'html:cash-and-cash-equivalents-and-restricted-cash-and-cash-equivalents-at-end-of-period-1-549', 'html:cash-and-cash-equivalents-and-restricted-cash-and-cash-equivalents-at-beginning-of-period-1']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:DepreciationNonproduction: ['html:depreciation-and-amortization-non-vehicle', 'html:non-vehicle', 'html:depreciation-and-amortization-non-vehicle-29']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:IncreaseDecreaseInAccruedLiabilities: ['html:accrued-liabilities', 'html:purchases-of-revenue-earning-vehicles-included-in-accounts-payable-and-accrued-liabilities-net-of-incentives']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:InterestPaidNet: ['html:vehicle', 'html:vehicles', 'html:purchases-of-non-vehicle-capital-assets-included-in-liabilities-subject-to-compromise', 'html:revenue-earning-vehicles-and-non-vehicle-capital-assets-acquired-through-capital-lease']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:OtherOperatingActivitiesCashFlowStatement: ['html:other', 'html:technology-related-intangible-and-other-asset-impairments', 'html:proceeds-from-property-and-other-equipment-disposed-of-or-to-be-disposed-of', 'html:sales-of-revenue-earning-vehicles-included-in-other-receivables']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:PaymentsToAcquireOtherPropertyPlantAndEquipment: ['html:non-vehicle-capital-asset-expenditures', 'html:capital-asset-expenditures-non-vehicle']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:ProceedsFromSaleOfOtherPropertyPlantAndEquipment: ['html:proceeds-from-disposal-of-non-vehicle-capital-assets', 'html:proceeds-from-non-vehicle-capital-assets-disposed-of', 'html:proceeds-from-non-vehicle-capital-assets-disposed-of-or-to-be-disposed-of']
- [multiple_html_vehicle_labels_same_usgaap_row] cash_flow us-gaap:RepaymentsOfDebt: ['html:repayments-of-debt', 'html:repayments-of-vehicle-debt', 'html:repayments-of-non-vehicle-debt']
- [multiple_html_vehicle_labels_same_usgaap_row] income_statement us-gaap:DepreciationAndAmortization: ['html:non-vehicle-depreciation-and-amortization', 'html:non-vehicle']
- [multiple_html_vehicle_labels_same_usgaap_row] income_statement us-gaap:InterestExpenseOperating: ['html:vehicle', 'html:vehicles', 'html:the-hertz-corporation-vehicles', 'html:the-hertz-corporation-non-vehicle']
- [depreciation_mapped_to_revenues] income_statement us-gaap:Revenues: ['html:revenues', 'html:depreciation-of-revenue-earning-vehicles-and-lease-charges', 'html:total-revenues']

## Duplicate Vehicle display labels on master (different canonical rows)
- balance_sheet 'Vehicle': 5 rows
- balance_sheet 'Vehicles': 2 rows