/**
 * Tiered debtor-name search variants. Keeps tighter variants first per product rules.
 */

function uniq(xs: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs) {
    const t = x.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

function stripMinorPunctuation(s: string): string {
  return s.replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
}

function ampAndVariants(s: string): string[] {
  const out = [s];
  if (/\band\b/i.test(s)) out.push(s.replace(/\band\b/gi, "&"));
  if (s.includes("&")) out.push(s.replace(/&/g, "and"));
  return out;
}

/** Legal suffix normalization variants (secondary tier only where noted). */
function suffixVariants(base: string): string[] {
  let t = base.trim();
  const outs = new Set<string>();

  const pairs: [RegExp, string][] = [
    [/\bincorporated\b\.?$/i, "Inc"],
    [/\binc\.?\b$/i, "Inc"],
    [/\bcorporation\b$/i, "Corp"],
    [/\bcorp\.?\b$/i, "Corp"],
    [/\bcompany\b$/i, "Co"],
    [/\bco\.?\b$/i, "Co"],
    [/\blimited liability company\b$/i, "LLC"],
    [/\bl\.?\s*l\.?\s*c\.?\b$/i, "LLC"],
    [/\bllc\b$/i, "LLC"],
    [/\blimited partnership\b$/i, "LP"],
    [/\bl\.?\s*p\.?\b$/i, "LP"],
    [/\blimited\b$/i, "Ltd"],
    [/\bltd\.?\b$/i, "Ltd"],
    [/\bplc\b$/i, "PLC"],
  ];

  outs.add(t);
  for (const [re, short] of pairs) {
    if (re.test(t)) {
      const stripped = t.replace(re, "").replace(/\s+/g, " ").trim();
      if (stripped.length >= 2) {
        outs.add(`${stripped} ${short}`);
        outs.add(`${stripped}, ${short}`);
      }
    }
  }

  // LLC dotted variant
  if (/\bllc\b/i.test(t)) {
    outs.add(t.replace(/\bllc\b/i, "L.L.C."));
  }
  if (/l\.l\.c\./i.test(t)) {
    outs.add(t.replace(/l\.l\.c\./gi, "LLC"));
  }

  return [...outs];
}

function broadFamilyStem(exact: string): string | null {
  let s = exact.replace(/,/g, "").replace(/\./g, " ").replace(/\s+/g, " ").trim();
  s = s
    .replace(/\b(llc|l\.l\.c\.|incorporated|inc|corp|corporation|company|co|lp|l\.p\.|ltd|limited|plc)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return s.length >= 4 ? s : null;
}

export type DebtorVariantOpts = {
  /** Only when user opts in — broader stems increase false positives. */
  broadNameFamily?: boolean;
};

/**
 * Returns ordered query variants: exact-first, then punctuation-stripped, suffix-normalized, uppercase mirror.
 * Holdings/Hldgs variants are appended last (secondary tier).
 */
export function debtorSearchVariants(exactLegalName: string, opts?: DebtorVariantOpts): string[] {
  const exact = exactLegalName.replace(/\s+/g, " ").trim();
  if (!exact) return [];

  const tier1 = uniq([exact]);
  const noComma = uniq([exact.replace(/,/g, "").trim()]);
  const noPunct = uniq([stripMinorPunctuation(exact)]);
  const amp = uniq(tier1.flatMap(ampAndVariants));

  const tier2 = uniq([...noComma, ...noPunct, ...amp]);

  const suf = uniq(tier2.flatMap(suffixVariants));

  const upperSet = uniq([...tier1, ...tier2, ...suf].map((s) => s.toUpperCase()));

  const holdings = uniq(
    [...tier2, ...suf].flatMap((s) => {
      const out: string[] = [];
      if (/\bholdings\b/i.test(s)) out.push(s.replace(/\bholdings\b/gi, "Hldgs"));
      if (/\bhldgs\b/i.test(s)) out.push(s.replace(/\bhldgs\b/gi, "Holdings"));
      return out;
    })
  );

  const broad =
    opts?.broadNameFamily === true
      ? uniq(
          [...tier2, ...suf]
            .map((s) => broadFamilyStem(s))
            .filter((x): x is string => Boolean(x))
        )
      : [];

  return uniq([
    ...tier1,
    ...tier2.filter((x) => !tier1.includes(x)),
    ...suf,
    ...upperSet,
    ...holdings,
    ...broad,
  ]);
}
