import type { RoicV2FundamentalDataset } from "@/lib/roic-ai-v2-datasets";

/** Datasets where most values are currency in raw dollars from Roic. */
const MILLIONS_DATASETS = new Set<RoicV2FundamentalDataset>([
  "income-statement",
  "balance-sheet",
  "cash-flow",
  "enterprise-value",
]);

/**
 * Ratios, margins, counts, and per-share style metrics — do not scale to millions.
 * (Avoid broad `_ratio$` — some Roic keys end in `ratio` but are dollar amounts.)
 */
function neverScaleToMillions(key: string): boolean {
  const k = key.toLowerCase();
  if (/_margin$/i.test(k)) return true;
  if (/^(eps|diluted_eps|eps_cont|div_per)/i.test(k)) return true;
  if (/per_sh|per_share|num_sh|sh_out|sh_for|avg_num_sh/i.test(k)) return true;
  if (/(_turn$|_days$|z_score|altman|yield|growth)/i.test(k)) return true;
  if (
    /^ev_to_|^tot_debt_to_|^net_debt_to_|^lt_debt_to_|^com_eqy_to_|^cash_flow_to_|^cfo_to_|^oper_inc_to_|^ebitda_to_|^ebitda_les_|^cap_expend|^cur_ratio$|^cash_ratio$|^quick_ratio$/i.test(
      k
    )
  ) {
    return true;
  }
  if (/^average_|^high_|^low_|^avg_/i.test(k) && /ev_to|ebit|sales/i.test(k)) return true;
  return false;
}

export function shouldScaleValueToMillions(dataset: RoicV2FundamentalDataset, key: string): boolean {
  if (!MILLIONS_DATASETS.has(dataset)) return false;
  return !neverScaleToMillions(key);
}

export function datasetShowsMillionsNote(dataset: RoicV2FundamentalDataset): boolean {
  return MILLIONS_DATASETS.has(dataset);
}

export function formatRoicTableNumber(
  dataset: RoicV2FundamentalDataset,
  key: string,
  value: number
): string {
  const neg = value < 0;
  if (shouldScaleValueToMillions(dataset, key)) {
    const m = value / 1e6;
    const text = Math.abs(m).toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 3,
    });
    return neg ? `-${text}` : text;
  }
  const isInt = Math.abs(value - Math.round(value)) < 1e-9;
  if (isInt) {
    return Math.round(value).toLocaleString(undefined, { maximumFractionDigits: 0 });
  }
  return value.toLocaleString(undefined, { maximumFractionDigits: 6 });
}
