/** Mock data for CenturyEggCredit — corporate credit research. LUMN sample. No real APIs. */

export const MOCK_TICKER = "LUMN";
export const MOCK_COMPANY_NAME = "Lumen Technologies, Inc.";
export const MOCK_SIC = "Telecom";
export const MOCK_CIK = "18926";

export const quickLoadTickers = [
  "LUMN", "T", "VZ", "CHTR", "FYBR", "BA", "F", "CCL", "HCA", "MGM", "CZR", "DISH",
];

export const mockWatchlist = ["LUMN", "CCL", "BA"];

export const mockCompanyBar = {
  ticker: MOCK_TICKER,
  name: MOCK_COMPANY_NAME,
  meta: `${MOCK_SIC} · CIK: ${MOCK_CIK} · Delaware`,
  fyEnd: "12/31",
  latestFiling: "2024-02-15",
  filingsCount: 142,
  count10K: 12,
  count8K: 48,
};

export const companyAnalysisTabs = [
  "Business Overview",
  "IR Page Indexer",
  "Business Model",
  "Historical Financial Statements",
  "KPI",
  "SEC XBRL Financials",
  "Working Capital",
  "Org Chart",
  "Capital Structure",
  "Recovery Analysis",
  "Liquidity Analysis",
  "Saved Documents",
  "SEC Filings",
  "FCC Filings",
  "Ratings Research Links",
  "News & Events",
  "Mgmt Presentations & Transcripts",
  "Earnings Releases",
  "Comps",
  "Company History",
  "Capital Allocation",
  "Credit Timeline",
  "Broker Research Reports",
  "Substack",
  "Reddit",
  "Twitter Sentiment",
  "The Cap Stack Rumor Mill",
  "Porter's Five Forces",
  "Industry Value Chain",
  "Competitors",
  "Competitor Operating Metrics",
] as const;

export const companyAnalysisWorkOutputTabs = [
  "Recommendation",
  "AI Memo and Deck",
  "Pre-Mortem Analysis",
  "Literary References",
  "Biblical References",
  "Jokes",
  "Dear Diary",
] as const;

export const companyAnalysisClaimsTabs = [
  "Risk from 10K",
  "Environmental Claims",
  "Litigation Claims",
  "Labor/Pension Claims",
  "Tax Claims",
  "Regulatory Claims",
  "Lease Claims",
  "Trade/Supply Chain Claims",
] as const;

export const companyAnalysisFraudChecksTabs = [
  "Forensic Accounting",
  "Entity Searches",
  "Liens",
  "Management Background Check",
  "Legal Searches",
  "Related Party Checks",
] as const;

export const pmDashboardTabs = [
  "Screeners",
  "Relative Value",
  "Distressed",
  "Portfolio",
  "Technicals",
  "Ideas & Alerts",
] as const;

// —— Overview ——
export const mockOverviewSummaryCards = [
  { label: "Net Leverage (LTM)", value: "7.0x", sub: "vs 7.25x covenant", status: "warning" as const },
  { label: "Interest Coverage", value: "1.8x", sub: "LTM", status: "warning" as const },
  { label: "Liquidity", value: "$1.7B", sub: "Cash + revolver", status: "ok" as const },
  { label: "Next Test", value: "Mar 2025", sub: "Quarterly", status: "neutral" as const },
];

export const mockBusinessDescription =
  "Lumen Technologies is a facilities-based technology and communications company providing integrated communications services to enterprise and wholesale customers in the US and internationally. The company emerged from Chapter 11 in November 2023 with a simplified capital structure. Core segments include Business and Mass Markets (legacy ILEC and fiber), with ongoing network transformation and cost initiatives. Key credit focus: leverage trajectory, FCF generation, and execution on asset sales.";

export const mockOverviewKeyMetrics = [
  { label: "Revenue (LTM)", value: "$14.6B", yoy: "-7%" },
  { label: "Adj. EBITDA (LTM)", value: "$4.2B", yoy: "-4%" },
  { label: "CapEx (LTM)", value: "$2.8B", yoy: "-6%" },
  { label: "FCF (LTM)", value: "-$0.2B", yoy: "—" },
  { label: "Gross Debt", value: "$7.4B", yoy: "—" },
  { label: "Net Debt", value: "$5.7B", yoy: "—" },
];

export const mockOverview = {
  profile: [
    { label: "Name", value: MOCK_COMPANY_NAME },
    { label: "Industry", value: MOCK_SIC },
    { label: "State", value: "Delaware" },
    { label: "HQ", value: "Monroe, LA" },
    { label: "FY End", value: "12/31" },
    { label: "CIK", value: MOCK_CIK },
  ],
  filingActivity: [
    { label: "10-K Annual", count: 12, last: "2024-02-15" },
    { label: "10-Q Quarterly", count: 28, last: "2024-11-01" },
    { label: "8-K Events", count: 48, last: "2024-10-20" },
    { label: "All Filings", count: 142, last: "" },
  ],
  recentFilings: [
    { form: "10-Q", desc: "Quarterly report", date: "2024-11-01" },
    { form: "8-K", desc: "Credit agreement amendment", date: "2024-10-20" },
    { form: "10-Q", desc: "Quarterly report", date: "2024-08-02" },
    { form: "8-K", desc: "Earnings release", date: "2024-07-31" },
  ],
};

// —— Credit Overview (HY / distressed lens) ——
export const mockCreditOverview = {
  businessSummary:
    "Lumen is a facilities-based telecom operator (legacy ILEC + fiber) with revenue concentrated in Business and Mass Markets. Cash flow is pressured by secular decline in legacy voice/data and competitive fiber overbuild; limited cyclicality but high capital intensity to maintain and extend network. Enterprise and wholesale have some recurring revenue; consumer is more transactional. Post–Ch. 11 (Nov 2023) capital structure reduced debt but leverage remains elevated; ability to pay debt depends on asset sales, cost cuts, and stabilizing EBITDA.",

  capitalStructure: {
    totalDebt: "$8.85B",
    cash: "$1.15B",
    netDebt: "$7.70B",
    buckets: [
      { name: "1L Secured (TL + Notes)", amount: "$6.90B", maturity: "2029–2031" },
      { name: "2L Unsecured Notes", amount: "$1.95B", maturity: "2030" },
    ],
    nearestMaturities: [
      { instrument: "5.000% Sr Sec 2029", amount: "$3.40B", date: "Nov 2029" },
      { instrument: "10.500% Sr Unsec 2030", amount: "$1.95B", date: "Nov 2030" },
      { instrument: "Exit TL B", amount: "$3.50B", date: "Nov 2031" },
    ],
  },

  liquidity: {
    cash: "$1.15B",
    revolverAvailability: "$0.55B",
    runwayNote: "Cash + revolver covers 12+ months at current burn; covenant test Mar 2025.",
  },

  keyMetrics: [
    { label: "Revenue (LTM)", value: "$14.6B", sub: "Declining" },
    { label: "Adj. EBITDA (LTM)", value: "$4.2B", sub: "Margin 28.8%" },
    { label: "CapEx (LTM)", value: "$2.8B", sub: "~67% of EBITDA" },
    { label: "Interest expense (LTM)", value: "$1.58B", sub: "" },
    { label: "FCF (LTM)", value: "-$1.6B", sub: "Negative" },
    { label: "Net leverage", value: "7.0x", sub: "Covenant ≤7.25x" },
    { label: "Interest coverage", value: "1.8x", sub: "Thin" },
  ],

  maturityWall: [
    { year: "2029", amount: "$3.40B", note: "Secured notes" },
    { year: "2030", amount: "$1.95B", note: "Unsecured" },
    { year: "2031", amount: "$3.50B", note: "TL B" },
  ],

  ratingsOutlook: [
    { agency: "Moody's", rating: "Caa1", outlook: "Stable", note: "Post-reorg" },
    { agency: "S&P", rating: "CCC+", outlook: "Stable", note: "Limited cushion" },
    { agency: "Fitch", rating: "CCC+", outlook: "Stable", note: "Refi risk 2029" },
  ],
  recentCreditEvents: ["Emergence from Ch. 11 (Nov 2023)", "Exit facility and new notes closed", "Credit agreement amendment (Oct 2024)"],

  keyRisks: [
    "Covenant: Net leverage 7.0x vs 7.25x limit; limited headroom; next test Mar 2025.",
    "Refinancing: $3.4B secured notes due Nov 2029; refi in higher-rate environment uncertain.",
    "Secular: Legacy revenue decline; fiber overbuild and competition pressure margins.",
    "FCF: Negative LTM; depends on asset sales and cost initiatives to improve.",
    "LME: Open baskets in credit agreement; uptier/drop-down risk to monitor.",
    "Customer concentration: Enterprise/wholesale exposure; key contract roll-offs.",
  ],

  keyPositives: [
    "Substantial 1L secured cushion; asset base supports recovery for secured holders.",
    "Recurring enterprise/wholesale revenue; some contract visibility.",
    "Cost programs and asset sales could de-lever and extend runway.",
    "Post-reorg structure simpler; creditor alignment improved.",
    "Revolver and cash provide near-term liquidity.",
  ],

  catalysts: [
    "Q1 2025 covenant test (net leverage ≤7.25x).",
    "Asset sale announcements or closures (fiber/ILEC).",
    "Refinancing or amendment activity ahead of 2029 maturity.",
    "Management cost and CapEx guidance updates.",
  ],

  debatePoints: [
    "Can the company generate positive FCF before the 2029 maturity?",
    "Is 7.25x covenant headroom sufficient through a downturn or slower asset sales?",
    "Where is the fulcrum: secured vs unsecured in a stress case?",
    "What multiple of EBITDA can non-core assets fetch to pay down debt?",
    "How much incremental capacity exists under the credit agreement for flexibility?",
  ],
};

// —— Financials ——
export const mockFinancialsIncome = [
  { line: "Revenue", fy2021: 19687, fy2022: 17478, fy2023: 14564, ltm: 14620 },
  { line: "Adj. EBITDA", fy2021: 7260, fy2022: 6100, fy2023: 4200, ltm: 4200 },
  { line: "EBITDA Margin %", fy2021: 36.9, fy2022: 34.9, fy2023: 28.9, ltm: 28.8 },
  { line: "D&A", fy2021: 3263, fy2022: 3101, fy2023: 2954, ltm: 2900 },
  { line: "Interest Expense", fy2021: 1525, fy2022: 1623, fy2023: 1568, ltm: 1580 },
  { line: "Net Income", fy2021: -571, fy2022: -8223, fy2023: -9884, ltm: -2100 },
];

export const mockFinancialsCashFlow = [
  { line: "Operating Cash Flow", fy2021: 4764, fy2022: 3642, fy2023: 1891, ltm: 1200 },
  { line: "CapEx", fy2021: 3245, fy2022: 3098, fy2023: 2814, ltm: 2800 },
  { line: "Free Cash Flow", fy2021: 1519, fy2022: 544, fy2023: -923, ltm: -1600 },
];

export const mockFinancialsChartYears = ["FY21", "FY22", "FY23", "LTM"];

/** Working capital — balances ($M) and efficiency (days). Mock LUMN-style. */
export const mockWorkingCapital = [
  { line: "Accounts receivable", kind: "dollars" as const, fy2021: 2100, fy2022: 1950, fy2023: 1820, ltm: 1780 },
  { line: "Inventory", kind: "dollars" as const, fy2021: 180, fy2022: 175, fy2023: 170, ltm: 168 },
  { line: "Other current assets", kind: "dollars" as const, fy2021: 920, fy2022: 880, fy2023: 840, ltm: 820 },
  { line: "Accounts payable", kind: "dollars" as const, fy2021: 2400, fy2022: 2200, fy2023: 2050, ltm: 2000 },
  { line: "Accrued expenses & other current liabilities", kind: "dollars" as const, fy2021: 2100, fy2022: 2055, fy2023: 1980, ltm: 1948 },
  { line: "Net working capital", kind: "dollars" as const, fy2021: -1300, fy2022: -1250, fy2023: -1200, ltm: -1180 },
  { line: "DSO", kind: "days" as const, fy2021: 39, fy2022: 41, fy2023: 45, ltm: 45 },
  { line: "DIO", kind: "days" as const, fy2021: 3, fy2022: 4, fy2023: 4, ltm: 4 },
  { line: "DPO", kind: "days" as const, fy2021: 44, fy2022: 46, fy2023: 48, ltm: 50 },
  { line: "Cash conversion cycle", kind: "days" as const, fy2021: -2, fy2022: -1, fy2023: 1, ltm: -1 },
];

// —— Capital Structure ——
export const mockCapitalStructure = [
  { instrument: "Exit Term Loan B", seniority: "1L Secured", priority: 1, amount: 2000, coupon: "SOFR+600", maturity: "Nov 2031", price: "~95", ytw: "~7.8%" },
  { instrument: "Exit TL B (Lvl 3)", seniority: "1L Secured", priority: 1, amount: 1500, coupon: "SOFR+550", maturity: "Nov 2031", price: "~94", ytw: "~7.5%" },
  { instrument: "5.000% Sr Sec Notes", seniority: "1L Secured", priority: 1, amount: 3400, coupon: "5.000%", maturity: "Nov 2029", price: "~82", ytw: "~8.4%" },
  { instrument: "10.500% Sr Unsec Notes", seniority: "2L Unsecured", priority: 2, amount: 1950, coupon: "10.500%", maturity: "Nov 2030", price: "~68", ytw: "~18.1%" },
];

// —— Covenants ——
export const mockCovenantSummaryCards = [
  { title: "Net Leverage", value: "7.0x", limit: "≤ 7.25x", status: "ok" as const },
  { title: "Interest Coverage", value: "1.8x", limit: "≥ 1.0x", status: "ok" as const },
  { title: "RP Basket", value: "Limited", limit: "—", status: "ok" as const },
  { title: "Incremental Capacity", value: "$500M+", limit: "100% EBITDA", status: "ok" as const },
];

export const mockCovenants = [
  { term: "Maintenance Covenant", value: "Total Net Leverage ≤ 7.25x — tested quarterly", status: "~7.0x LTM" },
  { term: "Restricted Payments", value: "No cash dividends until leverage < 4.5x. Limited RP basket.", status: "OK" },
  { term: "Permitted Indebtedness", value: "Incremental: $500M or 100% EBITDA (greater of). General: $150M.", status: "OK" },
  { term: "Asset Sales", value: "365-day reinvestment right. 50% cash sweep at >4.5x leverage.", status: "OK" },
  { term: "Change of Control", value: "101% put right triggered on CoC event.", status: "OK" },
  { term: "LME Vulnerability", value: "Open baskets; uptier/drop-down risk moderate. Monitor.", status: "Watch" },
];

// —— Filings ——
export const mockFilings = [
  { form: "10-Q", description: "Quarterly report (Q3 2024)", date: "2024-11-01" },
  { form: "8-K", description: "Credit agreement amendment", date: "2024-10-20" },
  { form: "10-Q", description: "Quarterly report (Q2 2024)", date: "2024-08-02" },
  { form: "8-K", description: "Earnings release — Q2 2024", date: "2024-07-31" },
  { form: "10-Q", description: "Quarterly report (Q1 2024)", date: "2024-05-03" },
  { form: "10-K", description: "Annual report (FY 2023)", date: "2024-02-15" },
  { form: "8-K", description: "Exit financing — emergence", date: "2023-11-07" },
  { form: "10-Q", description: "Quarterly report (Q3 2023)", date: "2023-11-02" },
  { form: "8-K", description: "Bankruptcy filing", date: "2023-08-14" },
  { form: "10-Q", description: "Quarterly report (Q2 2023)", date: "2023-08-04" },
];

// —— Ratings ——
export const mockRatings = [
  { agency: "Moody's", rating: "Caa1", outlook: "Stable", action: "Nov 2023", note: "Emerged from Ch. 11" },
  { agency: "S&P", rating: "CCC+", outlook: "Stable", action: "Nov 2023", note: "Post-reorg" },
  { agency: "Fitch", rating: "CCC+", outlook: "Stable", action: "Dec 2023", note: "Elevated default risk" },
];

// —— News & Events (timeline) ——
export const mockNewsEvents = [
  { date: "2024-11-05", title: "Q3 2024 earnings", detail: "Revenue in line; FCF negative. Guidance reaffirmed.", type: "earnings" as const },
  { date: "2024-10-20", title: "Credit agreement amendment", detail: "8-K filed; covenant relief and pricing update.", type: "filing" as const },
  { date: "2024-08-02", title: "Q2 2024 10-Q", detail: "Liquidity update; revolver availability.", type: "filing" as const },
  { date: "2023-11-07", title: "Emergence from Chapter 11", detail: "Exit financing closed; new capital structure effective.", type: "event" as const },
  { date: "2023-08-14", title: "Chapter 11 filing", detail: "Voluntary petitions; RSA with creditor groups.", type: "event" as const },
  { date: "2023-07-26", title: "Forbearance agreement", detail: "Consent from lenders; waiver of defaults.", type: "event" as const },
];

// —— AI Memo and Deck ——
export const mockCreditMemo = {
  ticker: "LUMN",
  asOf: "2024-11-15",
  summary: "Lumen emerged from Chapter 11 in Nov 2023 with a simplified capital structure. Secured notes (5% 2029) trade at ~82c (8.4% YTW). Credit remains challenged: leverage ~7.0x, FCF negative, and limited cushion to 7.25x covenant. Upside from asset sales and cost cuts; key risk is execution and refinancing 2029 maturity.",
  thesis: "Post-reorg optionality with secured exposure. Enterprise value supports 1L recovery; 2L unsecured is more binary. Name suitable for distressed/special situations book with appropriate position sizing.",
  keyRisks: [
    "Leverage at 7.0x with limited headroom to 7.25x covenant; quarterly test in Mar 2025.",
    "FCF negative LTM; dependency on asset sales and cost initiatives to improve trajectory.",
    "2029 secured maturity $3.4B; refinancing risk in a higher-rate environment.",
    "Competitive pressure in legacy segments; revenue decline may persist.",
  ],
  recommendation: "Market Weight (Secured) / Underweight (Unsecured). Prefer 5% Sr Sec 2029 in secured bucket; avoid 10.5% unsecured for all but highest risk tolerance.",
};

// —— PM Dashboard: Screeners ——
export const mockScreenerResults = [
  { ticker: "LUMN", name: "Lumen Technologies", sector: "Telecom", rating: "CCC+", spread: "650", price: "82" },
  { ticker: "CCL", name: "Carnival Corp", sector: "Leisure", rating: "B", spread: "420", price: "94" },
  { ticker: "DISH", name: "DISH Network", sector: "Telecom", rating: "CCC", spread: "1200", price: "45" },
  { ticker: "FYBR", name: "Frontier Comm", sector: "Telecom", rating: "B-", spread: "380", price: "96" },
  { ticker: "CZR", name: "Caesars Entertainment", sector: "Gaming", rating: "B+", spread: "320", price: "98" },
  { ticker: "MGM", name: "MGM Resorts", sector: "Gaming", rating: "BB-", spread: "280", price: "99" },
];

// —— PM Dashboard: Relative Value ——
export const mockRelativeValue = [
  { ticker: "LUMN", spread: 650, duration: 4.2, rating: "CCC+", sector: "Telecom" },
  { ticker: "T", spread: 180, duration: 5.1, rating: "BBB-", sector: "Telecom" },
  { ticker: "VZ", spread: 140, duration: 6.0, rating: "BBB+", sector: "Telecom" },
  { ticker: "CHTR", spread: 320, duration: 4.8, rating: "BB+", sector: "Telecom" },
  { ticker: "FYBR", spread: 380, duration: 4.5, rating: "B-", sector: "Telecom" },
];

// —— PM Dashboard: Distressed ——
export const mockDistressed = [
  { ticker: "LUMN", price: 82, spread: 650, comment: "Post-reorg; covenant watch" },
  { ticker: "DISH", price: 45, spread: 1200, comment: "Capital structure stress" },
  { ticker: "RITE", price: 38, spread: 1800, comment: "Bankruptcy risk" },
];

// —— PM Dashboard: Portfolio ——
export const mockPortfolioSummary = [
  { label: "Total MV", value: "$124.5M" },
  { label: "Names", value: "18" },
  { label: "Avg Spread", value: "385 bps" },
  { label: "Duration", value: "4.8" },
];

export const mockPortfolioHoldings = [
  { ticker: "LUMN 5% 2029", amount: "12.5", mv: "10.2", spread: "650" },
  { ticker: "CCL 10% 2028", amount: "8.0", mv: "7.5", spread: "420" },
  { ticker: "T 4.65% 2030", amount: "15.0", mv: "14.2", spread: "180" },
  { ticker: "VZ 4.5% 2031", amount: "10.0", mv: "9.6", spread: "140" },
  { ticker: "MGM 5.75% 2027", amount: "6.0", mv: "5.9", spread: "280" },
];

// —— PM Dashboard: Technicals (placeholder series) ——
export const mockTechnicalsPrice = [
  { date: "Sep", value: 78 },
  { date: "Oct", value: 80 },
  { date: "Nov", value: 82 },
  { date: "Dec", value: 81 },
];

// —— Ideas & Alerts ——
export const mockIdeas = [
  { ticker: "LUMN", side: "Long" as const, thesis: "Post-reorg optionality; secured at 82c with 8.4% YTW. Covenant headroom tight but manageable; asset sales could de-lever.", spread: "+650bps", rating: "CCC+" },
  { ticker: "CCL", side: "Short" as const, thesis: "Maturity wall 2026; refinancing risk in current spread environment.", spread: "+420bps", rating: "B" },
  { ticker: "BA", side: "Long" as const, thesis: "IG name trading wide; recovery play on 737 MAX and defense.", spread: "+180bps", rating: "BBB-" },
  { ticker: "T", side: "Long" as const, thesis: "Stabilizing FCF; telecom comp at attractive spread vs VZ.", spread: "+180bps", rating: "BBB-" },
];

export const mockNews = [
  { date: "2024-11-05", headline: "Q3 2024 earnings beat; management reaffirms guidance", source: "Press release" },
  { date: "2024-10-20", headline: "Credit agreement amendment filed (8-K)", source: "SEC EDGAR" },
  { date: "2024-08-02", headline: "10-Q filed; liquidity update", source: "SEC EDGAR" },
];
