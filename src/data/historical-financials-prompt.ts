import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";
import HISTORICAL_FINANCIALS_PROMPT_TEMPLATE_RAW from "./historical-financials-llm.prompt.txt";

/**
 * Forensic historical model prompt for the Historical Financial Statements tab.
 * Placeholders: [company name], [ticker] (case-insensitive for the prose forms).
 */
export const HISTORICAL_FINANCIALS_PROMPT_TEMPLATE = HISTORICAL_FINANCIALS_PROMPT_TEMPLATE_RAW;

export function fillHistoricalFinancialsPromptPlaceholders(
  template: string,
  companyName: string,
  tickerOrWorkspaceKey: string
): string {
  return fillCompanyPromptTemplate(template, tickerOrWorkspaceKey, companyName);
}
