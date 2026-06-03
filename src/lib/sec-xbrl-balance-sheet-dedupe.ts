/**
 * Balance sheet presentation cleanup: filers sometimes expose two sibling lines that carry the
 * same monetary amount but use a broader vs narrower label (e.g. "Other investments" vs
 * "Other long-term investments"). XBRL treats them as different concepts, but for a face
 * statement grid they read as duplicates. Typical cases: overlapping labels for marketable
 * securities (terse vs role/standard label, or generic vs `…Noncurrent` QName), and other
 * investment captions.
 *
 * `mergeBalanceSheetPeriodCompatibleCaptionDuplicates` merges **different** QNames when every
 * column is either empty in both, non-null in only one, or both nearly equal — and captions
 * are the same or strict word-subset within a small **family** (investments / intangible assets net).
 * We intentionally do **not** merge long affiliate-style lines with successor tags (e.g. cost method
 * investments): those stay as **separate rows** so renames/reclasses remain visible.
 */

const LABEL_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "at",
  "for",
  "in",
  "less",
  "net",
  "of",
  "on",
  "or",
  "the",
  "to",
  "total",
]);

export type BsRowLike = {
  concept: string;
  label: string;
  depth: number;
  values: Record<string, number | null>;
  /** When set (axis-sliced face rows), merge/dedupe only within the same slice. */
  productOrServiceMember?: string | null;
};

export type BsNodeLike = {
  concept: string;
  depth: number;
  label: string;
  preferredLabelRole: string | null;
};

function labelTokens(label: string): Set<string> {
  const t = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length > 0 && !LABEL_STOPWORDS.has(w));
  return new Set(t);
}

function conceptLocalName(concept: string): string {
  const i = concept.lastIndexOf(":");
  return (i >= 0 ? concept.slice(i + 1) : concept).trim();
}

/** For QName prefix checks (MarketableSecurities vs MarketableSecuritiesNoncurrent). */
function conceptLocalNorm(concept: string): string {
  return conceptLocalName(concept).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** Groups near-duplicate captions that share display amounts; keep axis slices separate. */
function rowDedupeGroupingKey(row: BsRowLike, periodKeys: string[]): string {
  return `${displayValueSignature(row, periodKeys)}\0${row.productOrServiceMember ?? ""}`;
}

function bsRowMergeKey(row: BsRowLike): string {
  const mem = row.productOrServiceMember ?? "";
  return `${row.concept}\0${mem}`;
}


function normalizeLabelForDedupe(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function rowLooksLikeInvestingCaption(label: string): boolean {
  return /invest|securit/i.test(label);
}

/** Label or concept suggests marketable / investment line — same heuristics for all passes. */
export function eligibleForSecurityOrInvestmentDedupe(row: BsRowLike): boolean {
  return rowLooksLikeInvestingCaption(row.label) || /invest|securit/i.test(conceptLocalName(row.concept));
}

/** Same caption family as duplicate "Intangible assets, net" / extension vs GAAP intangibles-net lines. */
export function eligibleForIntangibleAssetsNetCaptionMerge(row: BsRowLike): boolean {
  if (/\bgoodwill\b/i.test(row.label)) return false;
  const local = conceptLocalName(row.concept);
  if (/goodwill/i.test(local) && !/intangible/i.test(local)) return false;

  const n = normalizeLabelForDedupe(row.label);
  if (n.includes("intangible") && n.includes("asset") && n.includes("net")) return true;
  const cn = conceptLocalNorm(row.concept);
  return /intangible/.test(cn) && /net/.test(cn);
}

function isStrictSubsetWords(a: Set<string>, b: Set<string>): boolean {
  if (a.size >= b.size) return false;
  for (const w of a) {
    if (!b.has(w)) return false;
  }
  return true;
}

/** Same null/non-null pattern and equal numeric values (after stable rounding). */
function displayValueSignature(row: BsRowLike, periodKeys: string[]): string {
  return periodKeys
    .map((k) => {
      const v = row.values[k];
      if (v === null || v === undefined || !Number.isFinite(v)) return "∅";
      return String(Math.round(v * 1e6) / 1e6);
    })
    .join("|");
}

function filledNumber(v: number | null | undefined): boolean {
  return v !== null && v !== undefined && Number.isFinite(v);
}

function nonNullPeriodCount(row: BsRowLike, periodKeys: string[]): number {
  return periodKeys.filter((pk) => filledNumber(row.values[pk])).length;
}

/**
 * Presentation linkbases sometimes list the same QName more than once (e.g. section header then total).
 * Merge non-null display values onto a single row per concept and prefer the caption with more populated periods.
 */
export function coalesceDuplicateBalanceSheetConceptRows<
  T extends BsRowLike & {
    rawValues: Record<string, number | null>;
    normalizationByPeriod: Record<string, unknown | null>;
  },
>(rows: T[], periodKeys: string[]): T[] {
  if (rows.length <= 1 || periodKeys.length === 0) return rows;

  const indicesByKey = new Map<string, number[]>();
  for (let i = 0; i < rows.length; i++) {
    const key = bsRowMergeKey(rows[i]!);
    const arr = indicesByKey.get(key) ?? [];
    arr.push(i);
    indicesByKey.set(key, arr);
  }

  const skip = new Set<number>();
  const out: T[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (skip.has(i)) continue;
    const row = rows[i]!;
    const ids = indicesByKey.get(bsRowMergeKey(row))!;
    if (ids.length < 2) {
      out.push(row);
      continue;
    }

    const firstIdx = ids[0]!;
    for (let k = 1; k < ids.length; k++) skip.add(ids[k]!);

    const base = rows[firstIdx]!;
    const merged = {
      ...base,
      values: { ...base.values },
      rawValues: { ...base.rawValues },
      normalizationByPeriod: { ...base.normalizationByPeriod },
    } as T;

    for (let k = 1; k < ids.length; k++) {
      const other = rows[ids[k]!]!;
      for (const pk of periodKeys) {
        if (!filledNumber(merged.values[pk]) && filledNumber(other.values[pk])) {
          merged.values[pk] = other.values[pk];
          merged.rawValues[pk] = other.rawValues[pk];
          merged.normalizationByPeriod[pk] = other.normalizationByPeriod[pk];
        }
      }
    }

    let bestLabel = merged.label;
    let bestDepth = merged.depth;
    let bestNn = nonNullPeriodCount(merged, periodKeys);
    for (let k = 1; k < ids.length; k++) {
      const o = rows[ids[k]!]!;
      const n = nonNullPeriodCount(o, periodKeys);
      if (n > bestNn) {
        bestNn = n;
        bestLabel = o.label;
        bestDepth = o.depth;
      }
    }
    merged.label = bestLabel;
    merged.depth = bestDepth;

    out.push(merged);
  }

  return out;
}

function nearlyEqualMoneyForMerge(a: number, b: number): boolean {
  const mag = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) <= Math.max(1e-9 * mag, 0.01);
}

/** Min local-name length so we never treat `assets` vs `assetscurrent` as a trivial prefix pair. */
const TAXONOMY_PREFIX_MERGE_MIN_LOCAL_LEN = 10;

export function periodsCompatibleNonConflicting(
  a: BsRowLike,
  b: BsRowLike,
  periodKeys: string[]
): boolean {
  for (const pk of periodKeys) {
    const va = a.values[pk];
    const vb = b.values[pk];
    const fa = filledNumber(va);
    const fb = filledNumber(vb);
    if (!fa && !fb) continue;
    if (fa && fb && !nearlyEqualMoneyForMerge(va!, vb!)) return false;
  }
  return true;
}

/**
 * Merge **distinct** QNames where one local element name strictly extends the other (e.g.
 * `MarketableSecurities` vs `MarketableSecuritiesNoncurrent`) and period columns are non-conflicting:
 * for each period, either both empty, one empty and one value (keep the value), or both equal.
 *
 * Restricted to rows that look like **securities / investments** so we do not collapse unrelated
 * prefix pairs (e.g. broad liability subtrees). Applied to balance-sheet **presentation** grids so
 * Excel / saved statement history do not double-count the same fact.
 */
export function mergeTaxonomyPrefixDuplicateBalanceSheetRows<
  T extends BsRowLike & {
    rawValues: Record<string, number | null>;
    normalizationByPeriod: Record<string, unknown | null>;
  },
>(rows: T[], periodKeys: string[]): T[] {
  if (rows.length <= 1 || periodKeys.length === 0) return rows;

  let work: T[] = [...rows];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i]!;
        const b = work[j]!;
        if (a.concept === b.concept) continue;
        if ((a.productOrServiceMember ?? null) !== (b.productOrServiceMember ?? null)) continue;

        const mustBeInvestLike =
          eligibleForSecurityOrInvestmentDedupe(a) || eligibleForSecurityOrInvestmentDedupe(b);
        if (!mustBeInvestLike) continue;

        const na = conceptLocalNorm(a.concept);
        const nb = conceptLocalNorm(b.concept);
        if (na.length < TAXONOMY_PREFIX_MERGE_MIN_LOCAL_LEN || nb.length < TAXONOMY_PREFIX_MERGE_MIN_LOCAL_LEN)
          continue;

        let shortRow: T;
        let longRow: T;
        let shortIdx: number;
        let longIdx: number;
        if (na.length < nb.length && nb.startsWith(na)) {
          shortRow = a;
          longRow = b;
          shortIdx = i;
          longIdx = j;
        } else if (nb.length < na.length && na.startsWith(nb)) {
          shortRow = b;
          longRow = a;
          shortIdx = j;
          longIdx = i;
        } else {
          continue;
        }

        if (!periodsCompatibleNonConflicting(shortRow, longRow, periodKeys)) continue;

        const merged: T = {
          ...longRow,
          depth: Math.min(shortRow.depth, longRow.depth),
          values: { ...longRow.values },
          rawValues: { ...longRow.rawValues },
          normalizationByPeriod: { ...longRow.normalizationByPeriod },
        };
        for (const pk of periodKeys) {
          if (!filledNumber(merged.values[pk]) && filledNumber(shortRow.values[pk])) {
            merged.values[pk] = shortRow.values[pk];
            merged.rawValues[pk] = shortRow.rawValues[pk];
            merged.normalizationByPeriod[pk] = shortRow.normalizationByPeriod[pk];
          }
        }

        const next = work.filter((_, k) => k !== shortIdx);
        const adjustedLong = longIdx > shortIdx ? longIdx - 1 : longIdx;
        next[adjustedLong] = merged;
        work = next;
        changed = true;
        break outer;
      }
    }
  }
  return work;
}

/**
 * Collapse presentation doubles when **all periods match**: (1) identical normalized label on two
 * QNames (common terseLabel), (2) taxonomy-style QName extension (MarketableSecurities vs
 * MarketableSecuritiesNoncurrent), (3) strict word-subset captions ("Marketable securities" vs
 * "Marketable securities, noncurrent").
 */
export function dedupeBalanceSheetNearDuplicateCaptionRows<T extends BsRowLike>(
  rows: T[],
  periodKeys: string[]
): T[] {
  if (rows.length <= 1 || periodKeys.length === 0) return rows;

  type Indexed = { row: T; index: number };
  const bySig = new Map<string, Indexed[]>();
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]!;
    const sig = rowDedupeGroupingKey(row, periodKeys);
    if (sig.split("|").every((x) => x === "∅")) continue;
    const arr = bySig.get(sig) ?? [];
    arr.push({ row, index });
    bySig.set(sig, arr);
  }

  const drop = new Set<number>();
  for (const group of bySig.values()) {
    if (group.length < 2) continue;

    const byDepth = new Map<number, Indexed[]>();
    for (const item of group) {
      const d = item.row.depth;
      const arr = byDepth.get(d) ?? [];
      arr.push(item);
      byDepth.set(d, arr);
    }

    for (const [, sub] of byDepth) {
      if (sub.length < 2) continue;

      const byNorm = new Map<string, Indexed[]>();
      for (const item of sub) {
        if (!eligibleForSecurityOrInvestmentDedupe(item.row)) continue;
        const key = normalizeLabelForDedupe(item.row.label);
        if (!key) continue;
        const arr = byNorm.get(key) ?? [];
        arr.push(item);
        byNorm.set(key, arr);
      }
      for (const arr of byNorm.values()) {
        if (arr.length < 2) continue;
        const sorted = [...arr].sort((a, b) => {
          const la = conceptLocalNorm(a.row.concept).length;
          const lb = conceptLocalNorm(b.row.concept).length;
          if (lb !== la) return lb - la;
          return a.index - b.index;
        });
        for (let i = 1; i < sorted.length; i++) drop.add(sorted[i]!.index);
      }

      const eligNames = sub
        .filter((x) => !drop.has(x.index))
        .filter((x) => eligibleForSecurityOrInvestmentDedupe(x.row));
      if (eligNames.length >= 2) {
        const sorted = [...eligNames].sort((a, b) => {
          const la = conceptLocalNorm(a.row.concept).length;
          const lb = conceptLocalNorm(b.row.concept).length;
          if (lb !== la) return lb - la;
          return a.index - b.index;
        });
        const accepted: Indexed[] = [];
        for (const cur of sorted) {
          const nc = conceptLocalNorm(cur.row.concept);
          if (!nc) {
            accepted.push(cur);
            continue;
          }
          const dominated = accepted.some((k) => {
            const nk = conceptLocalNorm(k.row.concept);
            return nk.length > nc.length && nk.startsWith(nc);
          });
          if (dominated) drop.add(cur.index);
          else accepted.push(cur);
        }
      }

      const eligible = sub
        .filter((x) => !drop.has(x.index))
        .filter((x) => eligibleForSecurityOrInvestmentDedupe(x.row));
      if (eligible.length < 2) continue;

      const withWords = eligible.map((x) => ({
        ...x,
        words: labelTokens(x.row.label),
      }));
      withWords.sort((a, b) => b.words.size - a.words.size);
      const kept: typeof withWords = [];
      for (const cur of withWords) {
        if (cur.words.size === 0) {
          kept.push(cur);
          continue;
        }
        const dominated = kept.some((k) => isStrictSubsetWords(cur.words, k.words));
        if (dominated) {
          drop.add(cur.index);
          continue;
        }
        kept.push(cur);
      }
    }
  }

  if (drop.size === 0) return rows;
  return rows.filter((_, i) => !drop.has(i));
}

function preferBalanceSheetMergeConcept(a: string, b: string): string {
  const score = (c: string) => {
    const isStd = c.startsWith("us-gaap:") || c.startsWith("ifrs-full:");
    const tail = c.includes(":") ? c.slice(c.indexOf(":") + 1) : c;
    return (isStd ? 1_000_000 : 0) + Math.min(tail.length, 9_999);
  };
  return score(a) >= score(b) ? a : b;
}

function captionPairAllowsPeriodCompatibleMerge(a: BsRowLike, b: BsRowLike): boolean {
  const na = normalizeLabelForDedupe(a.label);
  const nb = normalizeLabelForDedupe(b.label);
  if (na.length > 0 && na === nb) return true;
  const wa = labelTokens(a.label);
  const wb = labelTokens(b.label);
  if (wa.size === 0 || wb.size === 0) return false;
  return isStrictSubsetWords(wa, wb) || isStrictSubsetWords(wb, wa);
}

/** Long BS captions filers later replace with shorter "other / cost method" investment lines. */
function hasLongFormAffiliateStyleInvestments(label: string): boolean {
  return /affiliate|joint\s+venture|advance\s+to|associates,|subsidiaries,|joint\s+ventures/i.test(
    label
  );
}

function mergeCaptionDuplicateFamily(a: BsRowLike, b: BsRowLike): "investment" | "intangibleNet" | null {
  const intA = eligibleForIntangibleAssetsNetCaptionMerge(a);
  const intB = eligibleForIntangibleAssetsNetCaptionMerge(b);
  if (intA && intB) return "intangibleNet";
  const invA = eligibleForSecurityOrInvestmentDedupe(a);
  const invB = eligibleForSecurityOrInvestmentDedupe(b);
  if (invA && invB) return "investment";
  return null;
}

function mergeTwoBalanceSheetPresentationRows<
  T extends BsRowLike & {
    rawValues: Record<string, number | null>;
    normalizationByPeriod: Record<string, unknown | null>;
  },
>(a: T, b: T, periodKeys: string[]): T {
  const nnA = nonNullPeriodCount(a, periodKeys);
  const nnB = nonNullPeriodCount(b, periodKeys);
  const [rich, spare] = nnA >= nnB ? [a, b] : [b, a];
  const merged = {
    ...rich,
    values: { ...rich.values },
    rawValues: { ...rich.rawValues },
    normalizationByPeriod: { ...rich.normalizationByPeriod },
  } as T;
  for (const pk of periodKeys) {
    if (!filledNumber(merged.values[pk]) && filledNumber(spare.values[pk])) {
      merged.values[pk] = spare.values[pk];
      merged.rawValues[pk] = spare.rawValues[pk];
      merged.normalizationByPeriod[pk] = spare.normalizationByPeriod[pk];
    }
  }
  merged.depth = Math.min(a.depth, b.depth);
  merged.concept = preferBalanceSheetMergeConcept(a.concept, b.concept);
  const la = a.label.trim().length;
  const lb = b.label.trim().length;
  if (la !== lb) merged.label = la > lb ? a.label : b.label;
  else if (nnA !== nnB) merged.label = nnA > nnB ? a.label : b.label;
  else merged.label = a.label;
  return merged;
}

/**
 * Merge **distinct** QNames that share an investment-style or intangible-net caption family when every
 * period is non-conflicting (empty/empty, one value, or both ~equal). Complements
 * {@link mergeTaxonomyPrefixDuplicateBalanceSheetRows} for pairs that are not taxonomy prefixes
 * (e.g. `OtherInvestments` vs `OtherLongTermInvestments`) and {@link dedupeBalanceSheetNearDuplicateCaptionRows}
 * when value signatures differ period-by-period.
 */
export function mergeBalanceSheetPeriodCompatibleCaptionDuplicates<
  T extends BsRowLike & {
    rawValues: Record<string, number | null>;
    normalizationByPeriod: Record<string, unknown | null>;
  },
>(rows: T[], periodKeys: string[]): T[] {
  if (rows.length <= 1 || periodKeys.length === 0) return rows;

  let work: T[] = [...rows];
  let changed = true;
  while (changed) {
    changed = false;
    outer: for (let i = 0; i < work.length; i++) {
      for (let j = i + 1; j < work.length; j++) {
        const a = work[i]!;
        const b = work[j]!;
        if (a.concept === b.concept) continue;
        if ((a.productOrServiceMember ?? null) !== (b.productOrServiceMember ?? null)) continue;

        const fam = mergeCaptionDuplicateFamily(a, b);
        if (!fam) continue;
        if (!periodsCompatibleNonConflicting(a, b, periodKeys)) continue;
        if (!captionPairAllowsPeriodCompatibleMerge(a, b)) continue;

        const noAffiliateCaption =
          !hasLongFormAffiliateStyleInvestments(a.label) && !hasLongFormAffiliateStyleInvestments(b.label);
        const bothAllEmpty =
          nonNullPeriodCount(a, periodKeys) === 0 && nonNullPeriodCount(b, periodKeys) === 0;
        const allowRelaxedDepth =
          fam === "investment" &&
          noAffiliateCaption &&
          bothAllEmpty &&
          Math.abs(a.depth - b.depth) === 1;
        const depthOk = a.depth === b.depth || allowRelaxedDepth;
        if (!depthOk) continue;

        const merged = mergeTwoBalanceSheetPresentationRows(a, b, periodKeys);
        work = work.filter((_, k) => k !== j);
        work[i] = merged;
        changed = true;
        break outer;
      }
    }
  }
  return work;
}

/** First DFS occurrence wins — avoids double-counting the same QName if repeated under the same role. */
export function dedupeBalanceSheetPresentationNodes<T extends BsNodeLike>(nodes: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const n of nodes) {
    if (seen.has(n.concept)) continue;
    seen.add(n.concept);
    out.push(n);
  }
  return out;
}
