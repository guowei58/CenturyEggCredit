import { parseCompetitorEarningsReadThrusInputs } from "@/data/competitor-earnings-readthrus-prompt";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export const CHANGE_LOG_MAX_COMPETITORS = 6;

export type ChangeLogCompetitorRef = {
  ticker: string;
  source: "readthrus-inputs" | "competitors-tab";
};

const SKIP_TICKER_VALUES = new Set(["N/A", "NA", "NONE", "PRIVATE", "—", "-", "TBD"]);

/** Split comma / semicolon / newline separated ticker lists (e.g. readthrus inputs). */
export function parseTickerList(raw: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const token of raw.split(/[,;\n\r\t]+/)) {
    const cleaned = token.trim().replace(/^\(|\)$/g, "");
    const t = sanitizeTicker(cleaned);
    if (!t || seen.has(t) || SKIP_TICKER_VALUES.has(cleaned.toUpperCase())) continue;
    seen.add(t);
    out.push(t);
  }
  return out;
}

/** Extract tickers from Competitors tab markdown (table Ticker column + parenthetical tickers). */
export function extractTickersFromCompetitorsText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  const add = (raw: string) => {
    const cleaned = raw.replace(/\*+/g, "").trim();
    if (!cleaned || SKIP_TICKER_VALUES.has(cleaned.toUpperCase())) return;
    const t = sanitizeTicker(cleaned);
    if (!t || seen.has(t)) return;
    seen.add(t);
    out.push(t);
  };

  const lines = text.split(/\r?\n/);
  let tickerCol = -1;

  for (const line of lines) {
    if (!line.includes("|")) continue;
    const parts = line.split("|").map((c) => c.trim());
    const cells = parts.length > 2 ? parts.slice(1, -1) : parts.filter(Boolean);
    if (cells.length === 0) continue;

    if (tickerCol < 0) {
      const idx = cells.findIndex((c) => /^ticker$/i.test(c.replace(/\*+/g, "").trim()));
      if (idx >= 0) {
        tickerCol = idx;
        continue;
      }
    }

    if (tickerCol >= 0 && tickerCol < cells.length) {
      add(cells[tickerCol] ?? "");
    }
  }

  for (const m of text.matchAll(/\(([A-Z][A-Z0-9]{0,4}(?:\.[A-Z]{1,2})?)\)/g)) {
    add(m[1] ?? "");
  }

  return out;
}

export function mergeChangeLogCompetitorTickers(
  subjectTicker: string,
  fromInputs: string[],
  fromCompetitorsTab: string[]
): ChangeLogCompetitorRef[] {
  const subject = subjectTicker.trim().toUpperCase();
  const seen = new Set<string>();
  const out: ChangeLogCompetitorRef[] = [];

  const push = (ticker: string, source: ChangeLogCompetitorRef["source"]) => {
    const t = sanitizeTicker(ticker);
    if (!t || t === subject || seen.has(t)) return;
    seen.add(t);
    out.push({ ticker: t, source });
  };

  for (const t of fromInputs) push(t, "readthrus-inputs");
  for (const t of fromCompetitorsTab) push(t, "competitors-tab");

  return out.slice(0, CHANGE_LOG_MAX_COMPETITORS);
}

/** Load competitor tickers from saved workspace tabs for Change Log source gathering. */
export async function loadChangeLogCompetitorTickers(
  subjectTicker: string,
  userId: string
): Promise<ChangeLogCompetitorRef[]> {
  const sym = sanitizeTicker(subjectTicker);
  if (!sym) return [];

  const [inputsRaw, competitorsRaw] = await Promise.all([
    readSavedContent(sym, "competitor-earnings-readthrus-inputs", userId),
    readSavedContent(sym, "competitors", userId),
  ]);

  const inputs = parseCompetitorEarningsReadThrusInputs(inputsRaw);
  const fromInputs = parseTickerList(inputs.transcriptCompanyTickers);
  const fromTab = competitorsRaw?.trim() ? extractTickersFromCompetitorsText(competitorsRaw) : [];

  return mergeChangeLogCompetitorTickers(sym, fromInputs, fromTab);
}
