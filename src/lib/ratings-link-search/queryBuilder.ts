import type { RatingsLinkSearchContext } from "./types";

function escapeQuotes(s: string): string {
  return s.replace(/"/g, '\\"').trim();
}

/** Distinct search terms: ticker, legal name, short aliases (cap list length). */
export function collectNameTerms(ctx: RatingsLinkSearchContext): string[] {
  const raw = [ctx.ticker, ctx.companyName, ...ctx.aliases];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of raw) {
    const x = t.trim();
    if (x.length < 1) continue;
    const key = x.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(x);
  }
  return out.slice(0, 8);
}

export function orGroupQuoted(terms: string[]): string {
  const use = terms.filter((t) => t.length >= 1).slice(0, 6);
  if (use.length === 0) return "";
  const inner = use.map((t) => `"${escapeQuotes(t)}"`).join(" OR ");
  return `(${inner})`;
}

export function orGroupBareTicker(terms: string[]): string {
  const tickers = terms.filter((t) => t.length <= 5 && /^[A-Za-z.-]+$/.test(t));
  const names = terms.filter((t) => !tickers.includes(t));
  const parts: string[] = [];
  if (names.length) parts.push(orGroupQuoted(names));
  for (const tk of tickers) {
    parts.push(tk.toUpperCase());
  }
  const merged = parts.filter(Boolean);
  return merged.length ? `(${merged.join(" OR ")})` : orGroupQuoted(terms);
}

/**
 * Query set: broad + narrow per agency. site: restricts to official domains.
 */
export function buildRatingsSearchQueries(ctx: RatingsLinkSearchContext): string[] {
  const terms = collectNameTerms(ctx);
  if (terms.length === 0) return [];

  const core = orGroupBareTicker(terms);
  const primary = ctx.companyName.trim() ? `"${escapeQuotes(ctx.companyName.trim())}"` : terms[0] ?? "";

  const queries: string[] = [];

  const broadTail = `(rating OR ratings OR notes OR "senior unsecured" OR ABS OR bond OR outlook)`;
  const moodyTail = `(rating OR "rating action" OR notes OR ABS OR CFR OR outlook)`;
  const spTail = `(rating OR ratings OR research OR notes OR ABS OR outlook OR commentary)`;

  queries.push(`site:fitchratings.com ${core} ${broadTail}`);
  queries.push(`site:moodys.com ${core} ${moodyTail}`);
  queries.push(`site:spglobal.com ${core} ${spTail}`);

  if (primary.length >= 2) {
    queries.push(`site:fitchratings.com ${primary} "senior unsecured"`);
    queries.push(`site:moodys.com ${primary} "credit rating"`);
    queries.push(`site:spglobal.com ${primary} "rating action"`);
  }

  queries.push(`site:fitchratings.com ${core} (affirm OR downgrade OR upgrade OR outlook OR "rating action")`);
  queries.push(`site:moodys.com ${core} (affirm OR downgrade OR upgrade OR watch OR outlook)`);
  queries.push(`site:spglobal.com ${core} (affirm OR downgrade OR upgrade OR outlook)`);

  queries.push(`site:fitchratings.com ${core} (research OR commentary OR "credit update" OR report)`);
  queries.push(`site:moodys.com ${core} (research OR commentary OR report OR analysis)`);
  queries.push(`site:spglobal.com ${core} (research OR report OR "credit commentary")`);

  const seen = new Set<string>();
  return queries.filter((q) => {
    if (seen.has(q)) return false;
    seen.add(q);
    return true;
  });
}
