/**
 * Inline XBRL debt-oriented text blocks: dynamic concept matching + continuation chains.
 */

export type IxDebtBlock = {
  /** QName e.g. us-gaap:DebtDisclosureTextBlock */
  concept: string;
  /** Visible-ish plain text (entities decoded, ix tags stripped). */
  plain: string;
  /** Start offset in `htmlIx` at opening `<ix:nonNumeric`. */
  startOffset: number;
  /** Prefer disclosure-style tags for ranking. */
  isDisclosureTextBlock: boolean;
};

function decodeBasicEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function stripIxInner(html: string): string {
  let result = html;
  let prev = "";
  let guard = 0;
  while (prev !== result && guard++ < 40) {
    prev = result;
    result = result.replace(/<ix:[-\w]+[^/>]*>([\s\S]*?)<\/ix:[-\w]+>/gi, "$1");
  }
  return result.replace(/<ix:[-\w]+[^/>]*\/>/gi, " ");
}

function normalizePlain(s: string): string {
  return decodeBasicEntities(stripIxInner(s))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function stripTagsPlain(s: string): string {
  return decodeBasicEntities(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

type Frag = { id: string | null; continuedAt: string | null; inner: string };

function parseAttrs(attrBlob: string): { id: string | null; continuedAt: string | null; name: string | null } {
  const id = attrBlob.match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  const continuedAt = attrBlob.match(/\bcontinuedAt\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  const name = attrBlob.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  return { id, continuedAt, name };
}

function parseContinuationFragments(htmlIx: string): Map<string, Frag> {
  const map = new Map<string, Frag>();
  const re = /<ix:continuation\b([^>]*)>([\s\S]*?)<\/ix:continuation>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlIx)) !== null) {
    const { id, continuedAt } = parseAttrs(m[1] ?? "");
    if (id) map.set(id, { id, continuedAt, inner: m[2] ?? "" });
  }
  return map;
}

export function isDebtLikeIxConceptQName(qname: string): boolean {
  if (!qname.trim()) return false;
  return /Debt|LongTermDebt|Borrowings|NotesPayable|CreditFacility|ConvertibleDebt|ExchangeableDebt|FinanceLease|FinancingArrangements|DebtAndFinanceLeaseObligations|BorrowingsOutstanding|FinancingLiabilit|SeniorNotes|RevolvingCredit|TermLoan/i.test(
    qname,
  );
}

function chainContinuationPlain(inner: string, firstAttrs: string, contMap: Map<string, Frag>): string {
  let text = stripTagsPlain(inner);
  let ref = parseAttrs(firstAttrs).continuedAt;
  const seen = new Set<string>();
  while (ref && !seen.has(ref)) {
    seen.add(ref);
    const frag = contMap.get(ref);
    if (!frag) break;
    text += " " + stripTagsPlain(frag.inner);
    ref = frag.continuedAt;
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Collect debt-related ix:nonNumeric blocks (including continuation chains).
 */
export function collectIxDebtBlocks(htmlIx: string): IxDebtBlock[] {
  const contMap = parseContinuationFragments(htmlIx);
  const out: IxDebtBlock[] = [];
  const re = /<ix:nonNumeric\b([^>]*)>([\s\S]*?)<\/ix:nonNumeric>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlIx)) !== null) {
    const attrs = m[1] ?? "";
    const concept = parseAttrs(attrs).name ?? "";
    if (!isDebtLikeIxConceptQName(concept)) continue;
    const plain = chainContinuationPlain(m[2] ?? "", attrs, contMap);
    const norm = normalizePlain(plain);
    if (norm.length < 36) continue;
    const isDisclosure =
      /(?:textblock|disclosuretextblock)/i.test(concept) ||
      /disclosure/i.test(concept) ||
      /policytextblock/i.test(concept);
    out.push({
      concept,
      plain,
      startOffset: m.index,
      isDisclosureTextBlock: isDisclosure,
    });
  }
  return out;
}

/** Prefixes for fuzzy overlap against note bodies (legacy helper shape). */
export function ixDebtPrefixesFromBlocks(blocks: IxDebtBlock[]): string[] {
  const prefixes: string[] = [];
  for (const b of blocks) {
    const n = normalizePlain(b.plain);
    if (n.length < 48) continue;
    let weight = b.isDisclosureTextBlock ? 1.15 : 1;
    const sliceLen = Math.min(200, Math.floor(180 * weight));
    prefixes.push(n.slice(0, sliceLen));
  }
  return prefixes;
}

export function ixOverlapBoostForSegment(bodyNorm: string, blocks: IxDebtBlock[]): number {
  let b = 0;
  for (const block of blocks) {
    const needle = normalizePlain(block.plain).slice(0, Math.min(120, block.plain.length));
    if (needle.length < 44) continue;
    if (bodyNorm.includes(needle)) {
      b += block.isDisclosureTextBlock ? 34 : 24;
    } else {
      /* Partial overlap — first clause only */
      const half = needle.slice(0, Math.min(72, needle.length));
      if (half.length >= 36 && bodyNorm.includes(half)) b += block.isDisclosureTextBlock ? 18 : 12;
    }
  }
  return Math.min(b, 85);
}
