import HISTORICAL_FINANCIALS_PROMPT_TEMPLATE_RAW from "./historical-financials-llm.prompt.txt";

/**
 * Forensic historical model prompt for the Historical Financial Statements tab.
 * Placeholders: [company name], [ticker] (case-insensitive for the prose forms).
 */
export const HISTORICAL_FINANCIALS_PROMPT_TEMPLATE = HISTORICAL_FINANCIALS_PROMPT_TEMPLATE_RAW;

export function fillHistoricalFinancialsPromptPlaceholders(
  template: string,
  companyName: string,
  ticker: string
): string {
  const dn = (companyName || "").trim() || ticker.trim();
  const tk = ticker.trim();
  return template
    .replace(/\[company name\]/gi, dn)
    .replace(/\[ticker\]/gi, tk)
    .replace(/\[COMPANY NAME\]/g, dn)
    .replace(/\[TICKER\]/g, tk);
}
