import { isAmbiguousTicker } from "@/lib/xSearch/utils";

export type MatchResult = {
  tickers: string[];
  companies: string[];
  matchedTerms: string[];
  matchType: "ticker" | "company" | "alias" | "mixed" | "none";
  confidence: number;
};

function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

function containsWord(hay: string, needle: string): boolean {
  const n = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`\\b${n}\\b`, "i");
  return re.test(hay);
}

function findTickerMentions(text: string, ticker: string): string[] {
  const tk = ticker.toUpperCase();
  const out: string[] = [];
  const t = text;

  // $TSLA, NASDAQ:TSLA, NYSE:T, BRK/B, etc.
  const patterns = [
    new RegExp(`\\$${tk}\\b`, "i"),
    new RegExp(`\\b(?:NASDAQ|NYSE|AMEX|OTC|LSE|TSX)\\s*:\\s*${tk}\\b`, "i"),
    new RegExp(`\\b${tk.replace("/", "\\/")}\\b`, "i"),
  ];
  for (const p of patterns) {
    if (p.test(t)) out.push(tk);
  }
  return uniq(out);
}

export function matchText(params: {
  ticker: string;
  companyName?: string;
  aliases: string[];
  text: string;
}): MatchResult {
  const tk = params.ticker.trim().toUpperCase();
  const text = (params.text ?? "").toString();
  const hay = text.toLowerCase();
  const aliases = (params.aliases ?? []).map((a) => a.trim()).filter(Boolean);

  const tickers = findTickerMentions(text, tk);
  const companies: string[] = [];
  const terms: string[] = [];

  const name = params.companyName?.trim();
  if (name && name.length >= 3 && hay.includes(name.toLowerCase())) {
    companies.push(name);
    terms.push(name);
  }

  for (const a of aliases) {
    if (a.length < 3) continue;
    if (hay.includes(a.toLowerCase())) {
      terms.push(a);
    }
  }

  if (tickers.length > 0) terms.push(tk);

  const hasTicker = tickers.length > 0;
  const hasCompany = companies.length > 0;
  const hasAlias = terms.some((t) => t !== tk && (!name || t !== name));

  let matchType: MatchResult["matchType"] = "none";
  if (hasTicker && (hasCompany || hasAlias)) matchType = "mixed";
  else if (hasCompany) matchType = "company";
  else if (hasAlias) matchType = "alias";
  else if (hasTicker) matchType = "ticker";

  let confidence = 0;
  if (matchType === "mixed") confidence = 0.9;
  else if (matchType === "company") confidence = 0.75;
  else if (matchType === "alias") confidence = 0.6;
  else if (matchType === "ticker") confidence = 0.55;

  // Ambiguity penalty: short/common tickers need stronger evidence.
  if (matchType === "ticker" && isAmbiguousTicker(tk)) confidence -= 0.25;
  if (matchType === "alias" && isAmbiguousTicker(tk)) confidence -= 0.08;
  confidence = Math.max(0, Math.min(1, confidence));

  return {
    tickers,
    companies: uniq(companies),
    matchedTerms: uniq(terms),
    matchType,
    confidence,
  };
}

