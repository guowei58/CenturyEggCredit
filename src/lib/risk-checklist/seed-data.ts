export type SeedQuestion = {
  questionCode: string;
  category: string;
  questionText: string;
  maxPoints: number;
  displayOrder: number;
  isDagger?: boolean;
};

export type SeedQuestionDef = Omit<SeedQuestion, "maxPoints">;

export const ISSUER_BUCKET_TOTAL_POINTS = 25;
/** Points moved from each non-industry issuer bucket into industry & business. */
export const ISSUER_INDUSTRY_POINTS_TRANSFER = 5;

/** Per-category issuer bucket caps (still sum to 100 across the four buckets). */
export const ISSUER_CATEGORY_BUCKET_POINTS: Record<string, number> = {
  industry_business: ISSUER_BUCKET_TOTAL_POINTS + ISSUER_INDUSTRY_POINTS_TRANSFER * 3,
  financial: ISSUER_BUCKET_TOTAL_POINTS - ISSUER_INDUSTRY_POINTS_TRANSFER,
  liquidity_capital: ISSUER_BUCKET_TOTAL_POINTS - ISSUER_INDUSTRY_POINTS_TRANSFER,
  management_governance: ISSUER_BUCKET_TOTAL_POINTS - ISSUER_INDUSTRY_POINTS_TRANSFER,
};

/** Split each bucket's points evenly across its questions (to the cent). */
export function assignEqualIssuerBucketPoints(
  questions: SeedQuestionDef[],
  bucketTotals: Record<string, number> = ISSUER_CATEGORY_BUCKET_POINTS
): SeedQuestion[] {
  const byCategory = new Map<string, SeedQuestionDef[]>();
  for (const q of questions) {
    if (!byCategory.has(q.category)) byCategory.set(q.category, []);
    byCategory.get(q.category)!.push(q);
  }

  const pointsByCode = new Map<string, number>();
  for (const [category, group] of byCategory.entries()) {
    const ordered = group.slice().sort((a, b) => a.displayOrder - b.displayOrder);
    const bucketTotal = bucketTotals[category] ?? ISSUER_BUCKET_TOTAL_POINTS;
    const totalCents = Math.round(bucketTotal * 100);
    const base = Math.floor(totalCents / ordered.length);
    const remainder = totalCents % ordered.length;
    ordered.forEach((q, i) => {
      pointsByCode.set(q.questionCode, (base + (i < remainder ? 1 : 0)) / 100);
    });
  }

  return questions.map((q) => ({
    ...q,
    maxPoints: pointsByCode.get(q.questionCode) ?? 0,
  }));
}

export const ISSUER_RISK_TEMPLATE = {
  name: "Standard Issuer Risk Checklist",
  version: 1,
  checklistType: "issuer" as const,
};

export const SECURITY_RISK_TEMPLATE = {
  name: "Standard Security Documentation Risk",
  version: 1,
  checklistType: "security" as const,
};

export const DAGGER_TEMPLATE = {
  name: "Standard Dagger Flags",
  version: 1,
  checklistType: "dagger" as const,
};

export const ISSUER_RISK_QUESTION_DEFS: SeedQuestionDef[] = [
  {
    questionCode: "IBR-01",
    category: "industry_business",
    questionText: "Is the business or its principal industry in secular decline?",
    displayOrder: 1,
  },
  {
    questionCode: "IBR-02",
    category: "industry_business",
    questionText:
      "Has organic revenue declined or grown by less than approximately 2% annually over the last three years?",
    displayOrder: 2,
  },
  {
    questionCode: "IBR-03",
    category: "industry_business",
    questionText: "Is the company losing market share in its principal markets?",
    displayOrder: 3,
  },
  {
    questionCode: "IBR-04",
    category: "industry_business",
    questionText:
      "Is technology, regulation, or a new business model materially disrupting the company's value proposition?",
    displayOrder: 4,
  },
  {
    questionCode: "IBR-05",
    category: "industry_business",
    questionText: "Is the product or service commoditized, with weak pricing power or low switching costs?",
    displayOrder: 5,
  },
  {
    questionCode: "IBR-06",
    category: "industry_business",
    questionText: "Is the business highly cyclical or exposed to volatile end markets?",
    displayOrder: 6,
  },
  {
    questionCode: "IBR-07",
    category: "industry_business",
    questionText: "Is the product discretionary, nonessential, or easy for customers to eliminate?",
    displayOrder: 7,
  },
  {
    questionCode: "IBR-08",
    category: "industry_business",
    questionText: "Does one customer exceed 15% of revenue, or do the top ten customers exceed 40%?",
    displayOrder: 8,
  },
  {
    questionCode: "IBR-09",
    category: "industry_business",
    questionText:
      "Is the company materially dependent on one supplier, brand, principal, distributor, or indirect sales channel?",
    displayOrder: 9,
  },
  {
    questionCode: "IBR-10",
    category: "industry_business",
    questionText: "Is less than 50% of revenue recurring, repeat, contracted, or supported by visible backlog?",
    displayOrder: 10,
  },
  {
    questionCode: "FIN-01",
    category: "financial",
    questionText: "Have normalized EBITDA margins declined materially for two or more years?",
    displayOrder: 11,
  },
  {
    questionCode: "FIN-02",
    category: "financial",
    questionText: "Does the company have high fixed costs or downside EBITDA decrementals above approximately 35%?",
    displayOrder: 12,
  },
  {
    questionCode: "FIN-03",
    category: "financial",
    questionText: "Has free cash flow been negative or highly volatile through a normal cycle?",
    displayOrder: 13,
  },
  {
    questionCode: "FIN-04",
    category: "financial",
    questionText: "Is normalized cash conversion below 50% of EBITDA?",
    displayOrder: 14,
  },
  {
    questionCode: "FIN-05",
    category: "financial",
    questionText:
      "Is maintenance capex above 15% of EBITDA, or is the company materially underinvesting in its assets?",
    displayOrder: 15,
  },
  {
    questionCode: "FIN-06",
    category: "financial",
    questionText: "Can working-capital movements consume more than 20% of annual EBITDA?",
    displayOrder: 16,
  },
  {
    questionCode: "FIN-07",
    category: "financial",
    questionText: "Do recurring addbacks exceed 20% of adjusted EBITDA, or repeatedly fail to convert into cash?",
    displayOrder: 17,
  },
  {
    questionCode: "FIN-08",
    category: "financial",
    questionText: "Is net leverage above 5.0x, materially above peers, or above the company's sustainable level?",
    displayOrder: 18,
  },
  {
    questionCode: "FIN-09",
    category: "financial",
    questionText: "Is EBITDA-to-cash-interest coverage below 2.0x under normalized conditions?",
    displayOrder: 19,
  },
  {
    questionCode: "LCS-01",
    category: "liquidity_capital",
    questionText: "Does the company have less than 18 months of liquidity under a reasonable downside case?",
    displayOrder: 20,
  },
  {
    questionCode: "LCS-02",
    category: "liquidity_capital",
    questionText:
      "Is there a material maturity, put, amortization payment, or refinancing need within 24 months without a clear solution?",
    displayOrder: 21,
  },
  {
    questionCode: "LCS-03",
    category: "liquidity_capital",
    questionText:
      "Does the company depend on continued external financing, asset sales, or favorable capital markets to remain adequately funded?",
    displayOrder: 22,
  },
  {
    questionCode: "LCS-04",
    category: "liquidity_capital",
    questionText:
      "Is secured debt high relative to asset value, or is collateral coverage weak or difficult to establish?",
    displayOrder: 23,
  },
  {
    questionCode: "LCS-05",
    category: "liquidity_capital",
    questionText: "Are pensions, leases, taxes, litigation, guarantees, or other non-debt claims greater than 0.5x EBITDA?",
    displayOrder: 24,
  },
  {
    questionCode: "LCS-06",
    category: "liquidity_capital",
    questionText: "Is the company materially exposed to floating rates or near-term interest-cost repricing?",
    displayOrder: 25,
  },
  {
    questionCode: "LCS-07",
    category: "liquidity_capital",
    questionText: "Is post-interest free cash flow insufficient to reduce leverage meaningfully over the next two years?",
    displayOrder: 26,
  },
  {
    questionCode: "MGT-01",
    category: "management_governance",
    questionText:
      "Has the company had more than two CEOs or CFOs during the last five years, excluding clearly planned succession?",
    displayOrder: 27,
  },
  {
    questionCode: "MGT-02",
    category: "management_governance",
    questionText:
      "Has management pursued value-destructive acquisitions, dividends, buybacks, or other aggressive capital allocation while leveraged?",
    displayOrder: 28,
  },
  {
    questionCode: "MGT-03",
    category: "management_governance",
    questionText:
      "Does management have a pattern of missing guidance, changing definitions, or providing unreliable disclosure?",
    displayOrder: 29,
  },
  {
    questionCode: "MGT-04",
    category: "management_governance",
    questionText: "Are sponsor, founder, or controlling-owner incentives poorly aligned with creditors?",
    displayOrder: 30,
  },
  {
    questionCode: "MGT-05",
    category: "management_governance",
    questionText:
      "Is there a history of accounting problems, restatements, related-party transactions, regulatory controversy, or questionable conduct?",
    displayOrder: 31,
  },
];

export const ISSUER_RISK_QUESTIONS: SeedQuestion[] = assignEqualIssuerBucketPoints(ISSUER_RISK_QUESTION_DEFS);

/** Short column labels for PM dashboard bucket drill-down. */
export const ISSUER_RISK_QUESTION_SHORT_LABELS: Record<string, string> = {
  "IBR-01": "Secular decline",
  "IBR-02": "Weak growth",
  "IBR-03": "Losing share",
  "IBR-04": "Disruption",
  "IBR-05": "Commoditized",
  "IBR-06": "Cyclical",
  "IBR-07": "Discretionary",
  "IBR-08": "Customer conc.",
  "IBR-09": "Supplier dep.",
  "IBR-10": "Low recurring",
  "FIN-01": "Margin decline",
  "FIN-02": "Fixed costs",
  "FIN-03": "Volatile FCF",
  "FIN-04": "Weak conversion",
  "FIN-05": "High capex",
  "FIN-06": "WC drag",
  "FIN-07": "Heavy addbacks",
  "FIN-08": "High leverage",
  "FIN-09": "Weak coverage",
  "LCS-01": "Liquidity runway",
  "LCS-02": "Near maturity",
  "LCS-03": "Needs funding",
  "LCS-04": "Weak collateral",
  "LCS-05": "Contingencies",
  "LCS-06": "Rate exposure",
  "LCS-07": "No deleveraging",
  "MGT-01": "Mgmt turnover",
  "MGT-02": "Bad allocation",
  "MGT-03": "Bad guidance",
  "MGT-04": "Misaligned owners",
  "MGT-05": "Accounting issues",
};

export function issuerRiskQuestionShortLabel(questionCode: string, questionText: string): string {
  return ISSUER_RISK_QUESTION_SHORT_LABELS[questionCode] ?? questionCode;
}

export const SECURITY_RISK_QUESTIONS: SeedQuestion[] = [
  {
    questionCode: "SEC-01",
    category: "security_documentation",
    questionText: "Is a material portion of EBITDA or asset value outside the guarantor or collateral package?",
    maxPoints: 15,
    displayOrder: 1,
  },
  {
    questionCode: "SEC-02",
    category: "security_documentation",
    questionText: "Is estimated collateral or enterprise-value coverage weak at the security's priority level?",
    maxPoints: 15,
    displayOrder: 2,
  },
  {
    questionCode: "SEC-03",
    category: "security_documentation",
    questionText: "Is there no maintenance covenant, or is covenant headroom weak?",
    maxPoints: 10,
    displayOrder: 3,
  },
  {
    questionCode: "SEC-04",
    category: "security_documentation",
    questionText: "Do the documents permit material additional pari passu or senior secured debt?",
    maxPoints: 15,
    displayOrder: 4,
  },
  {
    questionCode: "SEC-05",
    category: "security_documentation",
    questionText: "Do restricted-payment, investment, or unrestricted-subsidiary baskets permit material value leakage?",
    maxPoints: 15,
    displayOrder: 5,
  },
  {
    questionCode: "SEC-06",
    category: "security_documentation",
    questionText: "Are J.Crew, Chewy, lien-subordination, or contractual-subordination protections absent or weak?",
    maxPoints: 15,
    displayOrder: 6,
  },
  {
    questionCode: "SEC-07",
    category: "security_documentation",
    questionText:
      "Are there material maturities, structurally senior claims, or potential priming claims ahead of the security?",
    maxPoints: 10,
    displayOrder: 7,
  },
  {
    questionCode: "SEC-08",
    category: "security_documentation",
    questionText: "Is the tranche small, illiquid, or difficult to exit during stress?",
    maxPoints: 5,
    displayOrder: 8,
  },
];

export const DAGGER_FLAG_QUESTIONS: SeedQuestion[] = [
  {
    questionCode: "DAG-01",
    category: "dagger",
    questionText: "Liquidity runway is less than 12 months.",
    maxPoints: 0,
    displayOrder: 1,
    isDagger: true,
  },
  {
    questionCode: "DAG-02",
    category: "dagger",
    questionText:
      "A material maturity or refinancing need exists within 18 months without a credible funded solution.",
    maxPoints: 0,
    displayOrder: 2,
    isDagger: true,
  },
  {
    questionCode: "DAG-03",
    category: "dagger",
    questionText:
      "The company has breached a covenant, missed a payment, received a going-concern warning, or hired restructuring advisers.",
    maxPoints: 0,
    displayOrder: 3,
    isDagger: true,
  },
  {
    questionCode: "DAG-04",
    category: "dagger",
    questionText:
      "Loss of one customer, supplier, license, contract, or regulatory approval could reduce EBITDA by more than 25%.",
    maxPoints: 0,
    displayOrder: 4,
    isDagger: true,
  },
  {
    questionCode: "DAG-05",
    category: "dagger",
    questionText:
      "A material fraud allegation, accounting investigation, restatement, or auditor resignation is outstanding.",
    maxPoints: 0,
    displayOrder: 5,
    isDagger: true,
  },
  {
    questionCode: "DAG-06",
    category: "dagger",
    questionText: "Legal, tax, environmental, or regulatory exposure could exceed one year of EBITDA.",
    maxPoints: 0,
    displayOrder: 6,
    isDagger: true,
  },
  {
    questionCode: "DAG-07",
    category: "dagger",
    questionText: "An existential regulatory or technological event could make the core product uneconomic or obsolete.",
    maxPoints: 0,
    displayOrder: 7,
    isDagger: true,
  },
  {
    questionCode: "DAG-08",
    category: "dagger",
    questionText:
      "Management or the sponsor has completed, attempted, or openly considered a coercive liability-management transaction.",
    maxPoints: 0,
    displayOrder: 8,
    isDagger: true,
  },
];

export const CATEGORY_LABELS: Record<string, string> = {
  industry_business: "Industry and Business Risk",
  financial: "Financial Risk",
  liquidity_capital: "Liquidity and Capital Structure Risk",
  management_governance: "Management, Governance and Ownership Risk",
  security_documentation: "Security / Documentation Risk",
  dagger: "Dagger Flags",
};

export const CATEGORY_MAX_POINTS: Record<string, number> = {
  ...ISSUER_CATEGORY_BUCKET_POINTS,
};

/** Issuer checklist buckets shown in PM dashboard and composite score header. */
export const ISSUER_RISK_BUCKET_KEYS = [
  "industry_business",
  "financial",
  "liquidity_capital",
  "management_governance",
] as const;

export const ISSUER_RISK_BUCKET_SHORT_LABELS: Record<(typeof ISSUER_RISK_BUCKET_KEYS)[number], string> = {
  industry_business: "Industry & Business",
  financial: "Financial",
  liquidity_capital: "Liquidity",
  management_governance: "Mgmt & Gov",
};
