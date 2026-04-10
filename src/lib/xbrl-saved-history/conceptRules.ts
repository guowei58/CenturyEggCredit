import type { MapRule, StatementKind } from "@/lib/xbrl-saved-history/types";

/** Prefer first matching rule (more specific patterns listed first). */
export const CONCEPT_RULES: MapRule[] = [
  // Income statement
  { match: /(^|:)(Revenues|RevenueFromContractWithCustomer)/i, standardized: "revenue", statement: "is", sortOrder: 10, displayLabel: "Revenue" },
  { match: /(^|:)Cost(Of)?Revenue/i, standardized: "cost_of_revenue", statement: "is", sortOrder: 20, displayLabel: "Cost of revenue" },
  { match: /(^|:)GrossProfit/i, standardized: "gross_profit", statement: "is", sortOrder: 30, displayLabel: "Gross profit" },
  { match: /(^|:)OperatingExpenses$/i, standardized: "operating_expenses", statement: "is", sortOrder: 40, displayLabel: "Operating expenses" },
  { match: /(^|:)OperatingIncomeLoss/i, standardized: "operating_income", statement: "is", sortOrder: 50, displayLabel: "Operating income (loss)" },
  { match: /(^|:)IncomeLossFromContinuingOperationsBeforeIncomeTaxes/i, standardized: "pretax_income", statement: "is", sortOrder: 60, displayLabel: "Income before income taxes" },
  { match: /(^|:)IncomeTaxExpenseBenefit/i, standardized: "income_tax", statement: "is", sortOrder: 70, displayLabel: "Income tax expense (benefit)" },
  { match: /(^|:)NetIncomeLoss$/i, standardized: "net_income", statement: "is", sortOrder: 100, displayLabel: "Net income (loss)" },
  { match: /(^|:)EarningsPerShareBasic/i, standardized: "eps_basic", statement: "is", sortOrder: 110, displayLabel: "EPS — basic" },
  { match: /(^|:)EarningsPerShareDiluted/i, standardized: "eps_diluted", statement: "is", sortOrder: 111, displayLabel: "EPS — diluted" },
  // Balance sheet
  { match: /(^|:)Assets$/i, standardized: "total_assets", statement: "bs", sortOrder: 10, displayLabel: "Total assets" },
  { match: /(^|:)AssetsCurrent/i, standardized: "current_assets", statement: "bs", sortOrder: 20, displayLabel: "Current assets" },
  { match: /(^|:)CashAndCashEquivalents/i, standardized: "cash", statement: "bs", sortOrder: 25, displayLabel: "Cash and cash equivalents" },
  { match: /(^|:)Liabilities$/i, standardized: "total_liabilities", statement: "bs", sortOrder: 40, displayLabel: "Total liabilities" },
  { match: /(^|:)LiabilitiesCurrent/i, standardized: "current_liabilities", statement: "bs", sortOrder: 45, displayLabel: "Current liabilities" },
  { match: /(^|:)LongTermDebt/i, standardized: "long_term_debt", statement: "bs", sortOrder: 55, displayLabel: "Long-term debt" },
  { match: /(^|:)StockholdersEquity$/i, standardized: "total_equity", statement: "bs", sortOrder: 70, displayLabel: "Total stockholders' equity" },
  { match: /(^|:)LiabilitiesAndStockholdersEquity/i, standardized: "liabilities_and_equity", statement: "bs", sortOrder: 80, displayLabel: "Total liabilities and equity" },
  // Cash flow
  { match: /(^|:)NetCashProvidedByUsedInOperatingActivities/i, standardized: "cfo", statement: "cf", sortOrder: 10, displayLabel: "Cash from operating activities" },
  { match: /(^|:)NetCashProvidedByUsedInInvestingActivities/i, standardized: "cfi", statement: "cf", sortOrder: 20, displayLabel: "Cash from investing activities" },
  { match: /(^|:)NetCashProvidedByUsedInFinancingActivities/i, standardized: "cff", statement: "cf", sortOrder: 30, displayLabel: "Cash from financing activities" },
  { match: /(^|:)PaymentsToAcquirePropertyPlantAndEquipment/i, standardized: "capex", statement: "cf", sortOrder: 25, displayLabel: "Capital expenditures" },
  { match: /(^|:)CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalentsPeriodIncreaseDecreaseIncludingExchangeRateEffect/i, standardized: "net_change_cash", statement: "cf", sortOrder: 50, displayLabel: "Net change in cash" },
];

export function conceptLocalName(concept: string): string {
  const t = concept.trim();
  const i = t.lastIndexOf(":");
  return (i >= 0 ? t.slice(i + 1) : t).trim();
}

export function mapConceptToStandard(
  concept: string,
  sheetKind: StatementKind
): { standardized: string; sortOrder: number; displayLabel: string; mappingNotes: string } {
  const local = conceptLocalName(concept);
  const hay = `${concept} ${local}`;
  for (const r of CONCEPT_RULES) {
    if (r.statement !== sheetKind) continue;
    if (r.match.test(hay)) {
      return { standardized: r.standardized, sortOrder: r.sortOrder, displayLabel: r.displayLabel, mappingNotes: "rule_match" };
    }
  }
  const slug = local.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase() || "unknown_concept";
  return {
    standardized: `unmapped__${slug}`,
    sortOrder: 9000,
    displayLabel: local || concept,
    mappingNotes: "no_rule_matched_kept_separate",
  };
}
