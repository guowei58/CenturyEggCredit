/**
 * Detect ticker instrument / quote pages surfaced by Google News or Yahoo RSS — not editorial news.
 */

export type StockPageFilterInput = {
  title: string;
  url: string;
  sourceDomain?: string | null;
};

/** Path segments that usually indicate a quote, profile, or market-data page. */
const STOCK_PAGE_URL_PATTERNS: RegExp[] = [
  /\/quote\/[^/?#]+/i,
  /\/quotes\/[^/?#]+/i,
  /\/market-data\/quotes\//i,
  /\/market-data\/stocks\//i,
  /\/investing\/stock\//i,
  /\/markets\/companies\/[^/?#]+/i,
  /\/markets\/stocks\/[^/?#]+/i,
  /\/finance\/stocks\/[^/?#]+/i,
  /\/symbol\/[^/?#]+/i,
  /\/equities\/[^/?#]+/i,
  /\/ticker\/[^/?#]+/i,
  /\/companies\/[^/?#]+\/(overview|profile|financials|key-metrics|analysis)\b/i,
];

/** Headlines that are almost always instrument pages, not stories. */
const STOCK_PAGE_TITLE_PATTERNS: RegExp[] = [
  /\bstock price today\b/i,
  /\bstock price, news, quote(?: & history)?\b/i,
  /\banalyst estimates?(?: & ratings)?\b/i,
  /\binteractive stock chart\b/i,
  /\bkey metrics\b/i,
  /\bfinancial summary\b/i,
  /\bcompany profile\b/i,
  /\bquote & (?:history|summary)\b/i,
  /,\s*[A-Z]{1,6}:(?:NSQ|NYSE|NAS|NYS|LON|LSE|A|N|T|PK)\s+summary\b/i,
  /\|\s*[A-Z]{1,6}\s*\|[^|]*\banalyst estimates\b/i,
  /\b[A-Z]{1,6}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}\s+[\d.]+\s+(?:call|put)\b/i,
  /\([A-Z]{1,6}\d{6}[CP]\d/i,
  /\s-\sBloomberg\.com\s*$/i,
  /\s-\sReuters\s*$/i,
  /\bInc\s+-\s+(Bloomberg|Reuters)\b/i,
  /\bStock Price & Latest News\b/i,
  /\bcheck out .+'s stock price\b/i,
  /\bstock price\b.*\bin real time\b/i,
  /^[A-Z0-9.-]+\s+-\s+\|\s*Stock Price\b/i,
  /\bstock forecasts?\b/i,
  /\bsec filings?\b/i,
  /\bquote comparis/i,
  /\bstock prices\b.*\bquote comparis/i,
  /\binvestment story is (?:evolving|shifting)\b/i,
  /\bpricing in\b.*\bdeal hopes\b/i,
  /\blatest stock news and headlines\b/i,
  /\bexpected to beat earnings estim/i,
  /\ba look at .+ valuation\b/i,
];

export function isLikelyTickerInstrumentPage(input: StockPageFilterInput): boolean {
  const title = input.title?.trim() ?? "";
  const url = input.url?.trim() ?? "";
  if (!title && !url) return false;

  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }

  if (STOCK_PAGE_URL_PATTERNS.some((re) => re.test(path) || re.test(url))) {
    return true;
  }

  if (STOCK_PAGE_TITLE_PATTERNS.some((re) => re.test(title))) {
    return true;
  }

  return false;
}
