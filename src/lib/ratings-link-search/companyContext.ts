import type { RatingsLinkSearchContext } from "./types";

const SUFFIX_RE =
  /\s*,?\s*\b(Inc\.?|Incorporated|LLC|L\.L\.C\.|L\.P\.|LP|PLC|N\.V\.|N\.V|Corp\.?|Corporation|Co\.?|Company|Ltd\.?|Limited|S\.A\.|S\.p\.A\.|B\.V\.)\b\.?$/gi;

function stripCorporateSuffixes(name: string): string {
  let s = name.trim();
  let prev = "";
  while (s !== prev) {
    prev = s;
    s = s.replace(SUFFIX_RE, "").trim();
  }
  return s;
}

export function deriveAliases(companyName: string, ticker: string): string[] {
  const t = ticker.trim().toUpperCase();
  const raw = companyName.trim();
  const out = new Set<string>([t]);
  if (raw.length) {
    out.add(raw);
    const stripped = stripCorporateSuffixes(raw);
    if (stripped.length >= 2) out.add(stripped);
    const words = stripped.split(/\s+/).filter((w) => w.length > 1);
    if (words[0] && words[0].length >= 3) out.add(words[0]);
    if (words.length >= 2 && words.slice(0, 2).join(" ").length <= 40) {
      out.add(words.slice(0, 2).join(" "));
    }
  }
  return Array.from(out);
}

export function mergeAliases(a: string[], b: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of a.concat(b)) {
    const k = x.trim();
    if (k.length < 1) continue;
    const key = k.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(k);
  }
  return out.slice(0, 12);
}

export function buildRatingsSearchContext(
  ticker: string,
  companyName: string,
  extraAliases?: string[]
): RatingsLinkSearchContext {
  const tk = ticker.trim().toUpperCase();
  const name = companyName.trim() || tk;
  const aliases = mergeAliases(deriveAliases(name, tk), extraAliases ?? []);
  return { ticker: tk, companyName: name, aliases };
}
