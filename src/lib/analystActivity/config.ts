import type { SourceType } from "./types";

function envFlag(name: string, defaultEnabled = false): boolean {
  const v = process.env[name]?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  if (v === "1" || v === "true" || v === "on") return true;
  return defaultEnabled;
}

export type AnalystActivitySourceConfig = {
  searchDiscovery: boolean;
  companyIr: boolean;
  finnhub: boolean;
  fmp: boolean;
  alphaVantage: boolean;
};

export function getSourceConfig(): AnalystActivitySourceConfig {
  return {
    searchDiscovery: envFlag("ANALYST_ACTIVITY_SEARCH_ENABLED", true),
    companyIr: envFlag("ANALYST_ACTIVITY_COMPANY_IR_ENABLED", true),
    finnhub: envFlag("ANALYST_ACTIVITY_FINNHUB_ENABLED", false) && Boolean(process.env.FINNHUB_API_KEY?.trim()),
    fmp: envFlag("ANALYST_ACTIVITY_FMP_ENABLED", false) && Boolean(process.env.FMP_API_KEY?.trim()),
    alphaVantage:
      envFlag("ANALYST_ACTIVITY_ALPHAVANTAGE_ENABLED", false) &&
      Boolean(process.env.ALPHAVANTAGE_API_KEY?.trim()),
  };
}

export const SOURCE_LABELS: Record<SourceType, string> = {
  search_discovery: "Web search",
  company_ir_coverage: "Company IR",
  finnhub_api: "Finnhub",
  fmp_api: "Financial Modeling Prep",
  alphavantage_api: "Alpha Vantage",
  yahoo_public: "Yahoo Finance",
  marketbeat: "MarketBeat",
  marketwatch: "MarketWatch",
  investing: "Investing.com",
  briefing: "Briefing.com",
};
