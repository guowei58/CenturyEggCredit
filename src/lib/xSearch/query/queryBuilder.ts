import { isAmbiguousTicker } from "../utils";

export type BuiltQuery = {
  query: string;
  explanation: string;
  ambiguous: boolean;
};

const FINANCE_TERMS = [
  "earnings",
  "guidance",
  "debt",
  "bond",
  "bonds",
  "credit",
  "downgrade",
  "upgrade",
  "refinancing",
  "maturity",
  "default",
  "bankruptcy",
  "EBITDA",
];

function q(s: string): string {
  return `"${s.replace(/"/g, "").trim()}"`;
}

export function buildXQuery(params: {
  ticker: string;
  companyName?: string;
  aliases?: string[];
  includeRetweets: boolean;
  language?: string;
}): BuiltQuery {
  const tk = params.ticker.trim().toUpperCase();
  const cashtag = `$${tk}`;
  const name = params.companyName?.trim();
  const aliases = (params.aliases ?? []).map((a) => a.trim()).filter(Boolean).slice(0, 4);

  const lang = (params.language ?? "").trim();
  const langClause = lang ? ` lang:${lang.toLowerCase()}` : "";
  const rtClause = params.includeRetweets ? "" : " -is:retweet";

  const ambiguous = isAmbiguousTicker(tk);

  const entityTerms: string[] = [q(cashtag), tk];
  if (name) entityTerms.push(q(name));
  for (const a of aliases) entityTerms.push(q(a));

  if (!ambiguous) {
    const query = `(${entityTerms.join(" OR ")})${langClause}${rtClause}`;
    return {
      query,
      ambiguous,
      explanation: "Ticker not highly ambiguous; query uses cashtag, ticker, and company aliases (when provided).",
    };
  }

  const strongAnchor = name ? `(${q(cashtag)} OR ${q(name)})` : q(cashtag);
  const finance = `(${FINANCE_TERMS.map((t) => (/\s/.test(t) ? q(t) : t)).join(" OR ")})`;
  const query = `(${strongAnchor} ${finance})${langClause}${rtClause}`;
  return {
    query,
    ambiguous,
    explanation:
      "Ticker appears ambiguous; query requires cashtag/company anchor plus finance-context terms to reduce noise.",
  };
}

