/** Roic v2 fundamental dataset keys (URL segment after ticker). Safe for client import. */

export const ROIC_V2_FUNDAMENTAL_DATASETS = [
  "income-statement",
  "balance-sheet",
  "cash-flow",
  "ratios-credit",
  "ratios-liquidity",
  "ratios-working-capital",
  "enterprise-value",
  "multiples",
  "per-share",
] as const;

export type RoicV2FundamentalDataset = (typeof ROIC_V2_FUNDAMENTAL_DATASETS)[number];

export const ROIC_V2_DATASET_TO_PATH: Record<RoicV2FundamentalDataset, string> = {
  "income-statement": "income-statement",
  "balance-sheet": "balance-sheet",
  "cash-flow": "cash-flow",
  "ratios-credit": "ratios/credit",
  "ratios-liquidity": "ratios/liquidity",
  "ratios-working-capital": "ratios/working-capital",
  "enterprise-value": "enterprise-value",
  multiples: "multiples",
  "per-share": "per-share",
};

export function isRoicV2Dataset(s: string): s is RoicV2FundamentalDataset {
  return (ROIC_V2_FUNDAMENTAL_DATASETS as readonly string[]).includes(s);
}

/** Ordered sections for Annual / Quarterly Financial Statements tabs (inner sub-tabs). */
export const ROIC_V2_STATEMENT_SECTIONS: { dataset: RoicV2FundamentalDataset; label: string }[] = [
  { dataset: "income-statement", label: "Income statement" },
  { dataset: "balance-sheet", label: "Balance sheet" },
  { dataset: "cash-flow", label: "Cash flow" },
  { dataset: "ratios-credit", label: "Credit ratios" },
  { dataset: "ratios-liquidity", label: "Liquidity ratios" },
  { dataset: "ratios-working-capital", label: "Working capital ratios" },
  { dataset: "enterprise-value", label: "Enterprise value" },
  { dataset: "multiples", label: "Multiples" },
  { dataset: "per-share", label: "Per share" },
];
