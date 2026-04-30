/**
 * Conservative subsidiary / legal-entity name extraction for USPTO search hints.
 * Avoids scanning the whole 10-K with a broad regex (that picks up random "… Inc." prose).
 */

/** Legal-form tails common in SEC Exhibit 21 (US + international). */
const ENTITY_LINE_END =
  /(?:,\s*)?(?:Inc\.?|Incorporated|LLC|L\.L\.C\.|L\.P\.|LP\b|Corp\.?|Corporation|Ltd\.?|Limited|PLC|N\.A\.|N\.A|B\.V\.|B\.V\.I\.|S\.A\.|S\.A\.R\.L\.?|S\.R\.L\.?|S\.r\.l\.|S\.p\.A\.|S\.L\.|S\.L\.U\.|Pte\.\s*Ltd\.?|ULC|Ltda\.?|GmbH|\bmbH\b|m\.b\.H\.|S\.A\.S\.|S\.A\.M\.|s\.r\.o\.|DAC|Co\.|Company|Trust|Partnership|ApS|A\/S|A\.?S\.|AB\b|ASA\b|Oy\b|Oyj|ehf\.?|hf\.?|N\.V\.|\bNV\b|d\.o\.o\.|Sp\.\s*z\s*o\.o\.|Kft\.|Zrt\.|OÜ|UAB|SE\b|AG\b|KG\b|A\.G\.|S\.C\.A\.|S\.C\.S\.|EEIG|GIE|SNC|SARL|C\.V\.|S\.\s*de\s*R\.L\.\s*de\s*C\.V\.)\s*\.?\s*$/i;

const PROSE_LINE = new RegExp(
  [
    "\\bshall\\b",
    "\\bwhich\\b",
    "\\bagreement\\b",
    "\\bfinancial\\s+statements\\b",
    "\\bcompany\\s+has\\b",
    "\\bnote\\s+\\d",
    "\\bfiscal\\b",
    "\\bmillion\\b",
    "\\bbillion\\b",
    "\\bpercent\\b",
    "\\bcopyright\\b",
    "\\ball\\s+rights\\b",
    "\\bpage\\s+\\d",
    "\\bitem\\s+\\d",
    "\\bpart\\s+iv\\b",
    "\\bsignatures\\b",
    "\\btable\\s+of\\s+contents\\b",
    "\\btherefore\\b",
    "\\bhowever\\b",
    "\\bdefined\\s+in\\b",
    "\\bpursuant\\s+to\\b",
    "\\bincluding\\s+but\\s+not\\b",
    "\\bmd&a\\b",
    "\\brisk\\s+factors\\b",
    "\\bbonus\\s+awarded\\b",
    "\\bmodified\\s+up\\s+or\\s+down\\b",
    "\\bpersonal\\s+performance\\b",
    "\\bactual\\s+company\\s+and\\s+personal\\b",
    "\\bexecutive\\s+compensation\\b",
    "\\bstock\\s+option\\b",
  ].join("|"),
  "i"
);

function decodeBasicHtmlEntities(s: string): string {
  let t = s;
  t = t.replace(/&#38;/gi, "&").replace(/&amp;/gi, "&");
  t = t.replace(/&#39;|&apos;/gi, "'");
  t = t.replace(/&quot;/gi, '"');
  t = t.replace(/&lt;/gi, "<");
  t = t.replace(/&gt;/gi, ">");
  t = t.replace(/&nbsp;/gi, " ");
  t = t.replace(/&#(\d{2,6});/g, (_, n) => {
    const code = parseInt(n, 10);
    if (!Number.isFinite(code) || code < 1 || code > 0x10ffff) return _;
    try {
      return String.fromCodePoint(code);
    } catch {
      return _;
    }
  });
  return t;
}

function stripTagsToSpaces(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Like stripTagsToSpaces but keeps newline characters so table rows stay on separate lines.
 * (stripTagsToSpaces collapses \\n — that merged entire Exhibit 21 tables into one unusable line.)
 */
function stripHtmlKeepingNewlines(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Insert newlines before block/table boundaries so subsidiary lists become lines. */
function htmlToRoughLines(html: string): string[] {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/table>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/td>/gi, "\t");
  const text = stripHtmlKeepingNewlines(withBreaks.replace(/\t/g, " | "));
  return text
    .split(/\n+/)
    .map((l) => l.trim().replace(/\s*\|\s*/g, " | ").replace(/ +/g, " ").trim())
    .filter((l) => l.length > 0);
}

/**
 * Some Exhibit 21 HTML concatenates multiple `Legal Name (State)` rows in one text node (only spaces between).
 */
function expandPackedParentheticalRows(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const t = line.replace(/\s+/g, " ").trim();
    if (!t) continue;
    const parenGroups = (t.match(/\([^)]+\)/g) ?? []).length;
    if (parenGroups <= 1) {
      out.push(t);
      continue;
    }
    const segments = t.split(/\)\s+(?=[A-Za-z0-9"“(])/);
    if (segments.length <= 1) {
      out.push(t);
      continue;
    }
    for (let i = 0; i < segments.length; i++) {
      let chunk = segments[i]!.trim();
      if (!chunk) continue;
      if (i < segments.length - 1 && !chunk.endsWith(")")) chunk += ")";
      out.push(chunk);
    }
  }
  return out;
}

function findExhibit21Slice(text: string): string | null {
  const lower = text.toLowerCase();
  const candidates: number[] = [];
  const reEx21 = /\bexhibit\s*(?:no\.?|number)?\s*21\b/;
  let m: RegExpExecArray | null;
  const s = lower;
  let idx = 0;
  while ((m = reEx21.exec(s.slice(idx))) !== null) {
    candidates.push(idx + m.index);
    idx += m.index + m[0].length;
    if (idx >= s.length) break;
  }
  const subIdx = lower.search(/\bsubsidiaries\s+of\s+the\s+registrant\b/);
  if (subIdx >= 0) candidates.push(subIdx);
  const listIdx = lower.search(/\blist\s+of\s+subsidiaries\b/);
  if (listIdx >= 0) candidates.push(listIdx);
  if (candidates.length === 0) return null;
  const start = Math.min(...candidates);
  const slice = text.slice(start, start + 150_000);
  const lowerSlice = slice.toLowerCase();
  const after = lowerSlice.slice(400);
  const nextEx = after.search(/\bexhibit\s*(?:no\.?|number)?\s*(?:2[2-9]|[3-9]\d)\b/);
  const endOffset = nextEx >= 0 ? 400 + nextEx : slice.length;
  return slice.slice(0, endOffset);
}

/** Trim decorative quotes / brackets — must NOT strip trailing `)` or Exhibit 21 lines like `Foo LLC (Delaware)` break before parenthetical parsing. */
const LEADING_LINE_NOISE = /^[\s\d.()•*-]+/;

function trimQuoteNoiseBothEnds(line: string): string {
  return line.replace(/^[\s"'“”‘’([{]+/, "").replace(/[\s"'”’\]}]+$/, "");
}

function cleanEntityLine(line: string): string {
  let s = line.replace(LEADING_LINE_NOISE, "");
  s = trimQuoteNoiseBothEnds(s);
  s = s.replace(/^\|+\s*/, "").replace(/\s*\|+$/, "");
  return s
    .replace(/\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** e.g. "Bermuda) Limited" / "CA), LLC" when "(" was in a previous table cell. */
function isLikelySplitNameFragment(line: string): boolean {
  const t = line.trim();
  const fc = t.indexOf(")");
  if (fc < 0) return false;
  const fo = t.indexOf("(");
  return fo < 0 || fo > fc;
}

/** "Association, Inc." with no distinctive leading token (often a table split). */
function isGenericShortEntityName(line: string): boolean {
  const t = line.trim();
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 3 || words.length < 2) return false;
  if (!ENTITY_LINE_END.test(t)) return false;
  return /^(Association|Company|Corporation|Holdings|Group|Trust|Partnership|International|Investments|Partners|Capital|Management|Services|Systems)\b/i.test(
    t
  );
}

/** US state-style tail only: "(CA), LLC" with no real name before it. */
function isAbbrevOnlyEntityTail(line: string): boolean {
  const t = line.trim();
  return (
    t.length < 42 &&
    /^\(?[A-Z]{2}\)?,?\s+(LLC|L\.L\.C\.|L\.P\.|LP)\s*\.?\s*$/i.test(t)
  );
}

function isPlausibleEntityLine(line: string): boolean {
  const t = trimQuoteNoiseBothEnds(line).trim();
  if (isLikelySplitNameFragment(t)) return false;
  if (isGenericShortEntityName(t)) return false;
  if (isAbbrevOnlyEntityTail(t)) return false;
  if (t.length < 6 || t.length > 130) return false;
  if (!ENTITY_LINE_END.test(t)) return false;
  if (PROSE_LINE.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 14 || words.length < 1) return false;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  const upper = (t.match(/[A-Z]/g) ?? []).length;
  const ratio = upper / letters.length;
  if (ratio < 0.12 && !/\bLLC\b/i.test(t) && !/\bLP\b/i.test(t)) return false;
  if (/^\d+[\d.)]*\s*$/.test(words[0] ?? "")) {
    const rest = words.slice(1).join(" ");
    if (isLikelySplitNameFragment(rest) || isGenericShortEntityName(rest) || isAbbrevOnlyEntityTail(rest)) return false;
    return rest.length >= 6 && ENTITY_LINE_END.test(rest);
  }
  return true;
}

/** Same as {@link isPlausibleEntityLine} but omits the uppercase-ratio gate — needed for international Exhibit 21 rows. */
function isPlausibleEntityLineFullExhibit(line: string): boolean {
  const t = trimQuoteNoiseBothEnds(line).trim();
  if (isLikelySplitNameFragment(t)) return false;
  if (isGenericShortEntityName(t)) return false;
  if (isAbbrevOnlyEntityTail(t)) return false;
  if (t.length < 6 || t.length > 130) return false;
  if (!ENTITY_LINE_END.test(t)) return false;
  if (PROSE_LINE.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length > 22 || words.length < 1) return false;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  if (/^\d+[\d.)]*\s*$/.test(words[0] ?? "")) {
    const rest = words.slice(1).join(" ");
    if (isLikelySplitNameFragment(rest) || isGenericShortEntityName(rest) || isAbbrevOnlyEntityTail(rest)) return false;
    return rest.length >= 6 && ENTITY_LINE_END.test(rest);
  }
  return true;
}

function smartJoinTableCells(parts: string[]): string {
  const cells = parts.map((c) => c.trim()).filter((c) => c.length > 0);
  if (cells.length === 0) return "";
  let s = cells[0]!;
  for (let i = 1; i < cells.length; i++) {
    const p = cells[i]!;
    const noSpace =
      /[(-]$/.test(s) || /^[,.)]/.test(p) || /^\)/.test(p) || s.endsWith("(");
    s += (noSpace ? "" : " ") + p;
  }
  return s.replace(/\s+/g, " ").trim();
}

/** Table header lines, footnote prose, and exhibit title blurbs — not subsidiary rows. */
function isExhibit21NoiseTableLine(cleaned: string): boolean {
  const t = cleaned.replace(/\s+/g, " ").trim();
  if (t.length < 3) return true;
  const lower = t.toLowerCase();
  const pipeFold = lower.replace(/\s*\|\s*/g, " ");
  if (/\bstate\s+or\s+country\s+of\s+incorporation\b/.test(pipeFold)) return true;
  if (/^\(?\s*\d{1,2}\)\s*this\s+is\s+a\s+subsidiary\s+of\b/i.test(lower)) return true;
  if (/\bthis\s+is\s+a\s+subsidiary\s+of\b/i.test(lower)) return true;
  if (/\bstate\s+or\s+country\s+of\s+incorporation\b/i.test(lower)) return true;
  if (/\b%\s*(of\s+)?ownership\b/i.test(lower) && /\s\|\s/.test(t)) return true;
  if (/\bname\s+doing\s+business\s+as\b/i.test(lower)) return true;
  if (!/\s\|\s/.test(t)) {
    if (/\band\s+subsidiaries\b.*\blist\s+of\s+subsidiaries\b/i.test(lower)) return true;
    if (/\blist\s+of\s+subsidiaries\b.*\bas\s+of\b/i.test(lower)) return true;
  }
  if (/^\|?\s*subsidiary\s*\|\s*state\b/i.test(lower)) return true;
  if (/^of\s+incorporation\b/i.test(lower) && t.length < 48) return true;
  if (/^state\s+or\s+country\b/i.test(lower) && t.length < 48) return true;
  return false;
}

/** Exhibit 21 col-2 is usually state / country; avoids requiring a US-style suffix on col-1. */
function looksLikeJurisdictionCell(s: string): boolean {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length < 2 || t.length > 70) return false;
  if (/^(name|subsidiary|jurisdiction|state|country|legal\s+name|organization)$/i.test(t)) return false;
  if (/\band\s+subsidiaries\b/i.test(t)) return false;
  if (/^of\s+(the\s+)?(incorporation|organization)\b/i.test(t)) return false;
  if (/\blist\s+of\s+subsidiaries\b/i.test(t)) return false;
  if (/\be\.g\.?\s/i.test(t) || /^e\.g\b/i.test(t)) return false;
  if (/^state\s+(or\s+country\s+)?of\s+(incorporation|organization)?\s*$/i.test(t)) return false;
  const lower = t.toLowerCase();
  if (/(^|[\s(])this\s+is\s+a\s+subsidiary\s+of\b/.test(lower)) return false;
  if (/^%\s*(of\s+)?ownership\b|^name\s+doing\s+business\s+as$/i.test(t)) return false;
  if (PROSE_LINE.test(t)) return false;
  if (/\d{4,}/.test(t)) return false;
  if (ENTITY_LINE_END.test(t)) return false;
  const wc = t.split(/\s+/).length;
  if (wc > 8) return false;
  if (/^[A-Z]{2}$/.test(t)) return true;
  if (/^(United States|United Kingdom|U\.S\.A\.|Various|See above|Not applicable|Federal)$/i.test(t)) return true;
  return /^[A-Za-z0-9][A-Za-z0-9\s.,'()-]+$/i.test(t);
}

function isPlausibleStandaloneNameCell(line: string): boolean {
  const t = trimQuoteNoiseBothEnds(line).trim();
  if (isLikelySplitNameFragment(t)) return false;
  if (isAbbrevOnlyEntityTail(t)) return false;
  if (isGenericShortEntityName(t)) return false;
  if (t.length < 6 || t.length > 130) return false;
  if (PROSE_LINE.test(t)) return false;
  if (/^(name|subsidiary|legal\s+name|company|jurisdiction|state|country|organization)$/i.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 14) return false;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  const upper = (t.match(/[A-Z]/g) ?? []).length;
  const ratio = upper / Math.max(letters.length, 1);
  if (ratio < 0.08) return false;
  if (/^\d+[\d.)]*\s*$/.test(words[0] ?? "") && words.length < 3) return false;
  return true;
}

/** Wider bounds for pipe-table name cells when parsing a full Exhibit 21 file (vs USPTO hint snippets). */
function isPlausibleStandaloneNameCellWide(line: string): boolean {
  const t = trimQuoteNoiseBothEnds(line).trim();
  if (isLikelySplitNameFragment(t)) return false;
  if (isAbbrevOnlyEntityTail(t)) return false;
  if (isGenericShortEntityName(t)) return false;
  if (t.length < 6 || t.length > 130) return false;
  if (PROSE_LINE.test(t)) return false;
  if (/^(name|subsidiary|legal\s+name|company|jurisdiction|state|country|organization)$/i.test(t)) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 22) return false;
  const letters = t.replace(/[^a-zA-Z]/g, "");
  if (letters.length < 4) return false;
  const upper = (t.match(/[A-Z]/g) ?? []).length;
  const ratio = upper / Math.max(letters.length, 1);
  if (ratio < 0.05) return false;
  if (/^\d+[\d.)]*\s*$/.test(words[0] ?? "") && words.length < 3) return false;
  return true;
}

function findJurisdictionColumnIndexFromEnd(cells: string[]): number {
  const endExclusive = cells.length >= 4 ? cells.length - 1 : cells.length;
  for (let i = endExclusive - 1; i >= 0; i--) {
    const c = cells[i]!.trim();
    if (!c) continue;
    if (/^\d{1,3}\s*%$/.test(c) || /^\d+$/.test(c)) continue;
    if (looksLikeJurisdictionCell(c)) return i;
  }
  return -1;
}

/** Cells from one table row (from `|` splits). Strips jurisdiction / % columns and rejoins split legal names. */
function deriveSubsidiaryNameFromPipedCells(cellsRaw: string[]): {
  name: string;
  hadJurisdiction: boolean;
  domicile: string | null;
} | null {
  const cells = cellsRaw
    .map((c) =>
      c
        .replace(/^\|+/g, "")
        .replace(/\|+$/g, "")
        .trim()
    )
    .filter((c) => c.length > 0);
  if (cells.length === 0) return null;
  if (cells.length === 1) return { name: cells[0]!, hadJurisdiction: false, domicile: null };

  const pctIdx = cells.findIndex((c) => /^\d{1,3}\s*%$/.test(c.trim()));
  if (pctIdx >= 2) {
    const jur = cells[pctIdx - 1]!.trim();
    if (looksLikeJurisdictionCell(jur) && !ENTITY_LINE_END.test(jur)) {
      const nameParts = cells.slice(0, pctIdx - 1);
      const name = smartJoinTableCells(nameParts);
      if (name) return { name, hadJurisdiction: true, domicile: jur };
    }
  }

  if (cells.length === 2) {
    const j = cells[1]!.trim();
    if (looksLikeJurisdictionCell(j) && !ENTITY_LINE_END.test(j)) {
      return { name: smartJoinTableCells([cells[0]!]), hadJurisdiction: true, domicile: j };
    }
  }

  /** No "%" column — many tables are still name | jurisdiction | DBA (etc.). */
  if (cells.length >= 3 && pctIdx < 0) {
    const j = cells[1]!.trim();
    if (looksLikeJurisdictionCell(j) && !ENTITY_LINE_END.test(j)) {
      const name = smartJoinTableCells([cells[0]!]);
      if (name) return { name, hadJurisdiction: true, domicile: j };
    }
  }

  const j = findJurisdictionColumnIndexFromEnd(cells);
  if (j < 0) {
    return { name: smartJoinTableCells(cells), hadJurisdiction: false, domicile: null };
  }
  if (j === 0) {
    const rest = cells.slice(1);
    if (rest.length === 0) return null;
    return {
      name: smartJoinTableCells(rest),
      hadJurisdiction: true,
      domicile: cells[0]!.trim() || null,
    };
  }

  let nameParts = cells.slice(0, j);
  while (
    nameParts.length > 1 &&
    /^\d{1,3}\s*%$/.test(nameParts[nameParts.length - 1]!.trim())
  ) {
    nameParts = nameParts.slice(0, -1);
  }
  const name = smartJoinTableCells(nameParts);
  const domicile = (cells[j] ?? "").trim() || null;
  return name ? { name, hadJurisdiction: true, domicile } : null;
}

/**
 * Many filers (e.g. Meta) use `Legal Name, LLC (Delaware)` — jurisdiction in trailing parentheses, not a second column.
 */
function trySplitParentheticalDomicile(line: string): { name: string; jur: string } | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (!t.endsWith(")") || !t.includes("(")) return null;
  const closeIdx = t.length - 1;
  const openIdx = t.lastIndexOf("(", closeIdx - 1);
  if (openIdx < 0) return null;
  const name = t.slice(0, openIdx).trim();
  const jur = t.slice(openIdx + 1, closeIdx).trim();
  if (!name || !jur || name.length < 6) return null;
  if (/\b(?:NYSE|NASDAQ|FINRA|CUSIP)\b/i.test(jur)) return null;
  if (/\bf[/ ]?k[/ ]?a\b|\bd[/ ]?b[/ ]?a\b|\bformerly\b|\bsee\s+note\b|\bas\s+defined\b/i.test(jur)) return null;
  if (!looksLikeJurisdictionCell(jur)) return null;
  if (!ENTITY_LINE_END.test(name)) return null;
  return { name, jur };
}

/**
 * Workiva-style Exhibit 21 HTML often puts "Legal Name Delaware" in one text run (no `|` between columns).
 * Peel trailing place tokens from the end when the remainder is a full legal-entity line.
 */
function trySplitExhibit21NameJurisdiction(line: string): { name: string; jur: string } | null {
  const t = line.replace(/\s+/g, " ").trim();
  if (t.length < 14 || !/\s/.test(t)) return null;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 3) return null;
  const maxN = Math.min(6, words.length - 1);
  for (let n = maxN; n >= 1; n--) {
    const jur = words.slice(-n).join(" ");
    const name = words.slice(0, -n).join(" ").trim();
    if (name.length < 8) continue;
    if (!looksLikeJurisdictionCell(jur)) continue;
    if (!ENTITY_LINE_END.test(name)) continue;
    return { name, jur };
  }
  return null;
}

function collectSubsidiaryNamesFromLines(
  lines: string[],
  maxNames: number,
  comprehensive = false,
  appendDomicile = false
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of lines) {
    const cleaned = cleanEntityLine(raw);
    if (isExhibit21NoiseTableLine(cleaned)) continue;
    let candidate: string | null = null;
    let hadJurisdiction = false;
    let domicileText: string | null = null;
    if (/\s\|\s/.test(cleaned)) {
      const derived = deriveSubsidiaryNameFromPipedCells(cleaned.split(/\s*\|\s*/));
      if (derived) {
        candidate = derived.name;
        hadJurisdiction = derived.hadJurisdiction;
        domicileText = derived.domicile;
      }
    } else {
      const parenSplit = trySplitParentheticalDomicile(cleaned);
      if (parenSplit) {
        candidate = parenSplit.name;
        hadJurisdiction = true;
        domicileText = parenSplit.jur;
      } else {
        const spaceSplit = trySplitExhibit21NameJurisdiction(cleaned);
        if (spaceSplit) {
          candidate = spaceSplit.name;
          hadJurisdiction = true;
          domicileText = spaceSplit.jur;
        } else {
          candidate = cleaned;
        }
      }
    }
    if (!candidate) continue;
    if (isLikelySplitNameFragment(candidate)) continue;
    if (isGenericShortEntityName(candidate)) continue;
    if (isAbbrevOnlyEntityTail(candidate)) continue;

    const okStrict = isPlausibleEntityLine(candidate);
    const okFull = comprehensive && isPlausibleEntityLineFullExhibit(candidate);
    const looseCell = comprehensive ? isPlausibleStandaloneNameCellWide : isPlausibleStandaloneNameCell;
    const okLoose = hadJurisdiction && looseCell(candidate);
    if (!okStrict && !okLoose && !okFull) continue;

    let displayLine = decodeBasicHtmlEntities(candidate);
    if (appendDomicile && domicileText && domicileText.trim()) {
      displayLine = `${displayLine} — ${decodeBasicHtmlEntities(domicileText.trim())}`;
    }

    const seenKey = displayLine.toLowerCase();
    if (seen.has(seenKey)) continue;
    seen.add(seenKey);
    out.push(displayLine);
    if (out.length >= maxNames) return out;
  }
  return out;
}

function collectSubsidiaryNamesFromExhibitTableLines(
  lines: string[],
  maxNames: number,
  comprehensive = false,
  appendDomicile = false
): string[] {
  return collectSubsidiaryNamesFromLines(lines, maxNames, comprehensive, appendDomicile);
}

/**
 * Parse a standalone Exhibit 21 HTML/text file (entire upload is the subsidiary list).
 * @param comprehensive When true, use relaxed validation and a full-schedule read (public-records profile), not a short USPTO hint list.
 */
export function extractSubsidiaryNamesFromStandaloneExhibitBody(
  rawText: string,
  maxNames = 40,
  comprehensive = false,
  appendDomicile = false
): string[] {
  if (!rawText || rawText.length < 80) return [];
  let lines = rawText.includes("<")
    ? htmlToRoughLines(rawText)
    : rawText
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/\t+/g, " | ").replace(/ +/g, " ").trim())
        .filter(Boolean);
  if (comprehensive) lines = expandPackedParentheticalRows(lines);
  return collectSubsidiaryNamesFromExhibitTableLines(lines, maxNames, comprehensive, appendDomicile);
}

/**
 * Extract names from the Exhibit 21 / "Subsidiaries of the Registrant" section only.
 * Returns [] if that section is not in this document (common when Exhibit 21 is a separate file).
 */
export function extractSubsidiaryNamesFromFilingForHints(
  rawText: string,
  maxNames = 24,
  comprehensive = false,
  appendDomicile = false
): string[] {
  if (!rawText || rawText.length < 200) return [];
  const slice = findExhibit21Slice(rawText);
  if (!slice) return [];

  let lines = slice.includes("<")
    ? htmlToRoughLines(slice)
    : slice
        .split(/\r?\n/)
        .map((l) => l.trim().replace(/\t+/g, " | ").replace(/ +/g, " ").trim())
        .filter(Boolean);

  if (comprehensive) lines = expandPackedParentheticalRows(lines);

  return collectSubsidiaryNamesFromExhibitTableLines(lines, maxNames, comprehensive, appendDomicile);
}

/**
 * Parse markdown pipe tables and bullet lines from saved Subsidiary List responses.
 */
export function parseSubsidiaryNamesFromSavedMarkdown(text: string, maxNames = 35): string[] {
  if (!text || text.trim().length < 40) return [];
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();

  function pushIfGood(s: string) {
    const t = cleanEntityLine(s);
    if (t.length < 4 || t.length > 130) return;
    if (PROSE_LINE.test(t)) return;
    const wordCount = t.split(/\s+/).length;
    if (ENTITY_LINE_END.test(t)) {
      if (wordCount > 14) return;
      if (!isPlausibleEntityLine(t) && wordCount > 8) return;
    } else {
      if (wordCount < 2 || wordCount > 9) return;
      if (!/^[A-Z0-9("']/.test(t)) return;
      if (/\b(the|and|or|for|with|from|this|that|these|those)\b/i.test(t)) return;
    }
    const k = t.toLowerCase();
    if (seen.has(k)) return;
    seen.add(k);
    out.push(t);
  }

  let nameColIndex = 0;
  let headerResolved = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) continue;

    const compact = trimmed.replace(/\s/g, "");
    if (/^\|?[-:|]+\|?$/.test(compact)) continue;

    const parts = trimmed.split("|").map((c) => c.replace(/\*\*/g, "").replace(/^`+|`+$/g, "").trim());
    if (parts.length < 3) continue;
    const cells = parts.slice(1, -1);
    if (cells.length < 1) continue;

    const headerHit = cells.findIndex((c) =>
      /^(subsidiary|entity|legal\s+name|company\s+name|name)(\s*\([^)]*\))?$/i.test(c.trim())
    );
    if (headerHit >= 0 && !headerResolved) {
      nameColIndex = headerHit;
      headerResolved = true;
      continue;
    }

    const cell = (cells[nameColIndex] ?? cells[0]).trim();
    if (
      cell.length >= 3 &&
      !/^(important|secondary|minor|unclear|source|notes?|role|jurisdiction|ownership|parent|why\s+it\s+matters)$/i.test(cell)
    ) {
      pushIfGood(cell);
    }
    if (out.length >= maxNames) return out;
  }

  if (out.length < 4) {
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.includes("|")) continue;
      const bullet = trimmed.match(
        /^[-*•]\s+\**([A-Za-z0-9("'][^*]{2,120}?(?:,\s*)?(?:LLC|Inc\.?|Corp\.?|Ltd\.?|L\.P\.|LP))\**/
      );
      if (bullet?.[1]) pushIfGood(bullet[1]);
      const numbered = trimmed.match(
        /^\d+[\d.)]\s+\**([A-Za-z0-9("'][^*]{2,120}?(?:,\s*)?(?:LLC|Inc\.?|Corp\.?|Ltd\.?|L\.P\.|LP))\**/
      );
      if (numbered?.[1]) pushIfGood(numbered[1]);
      if (out.length >= maxNames) break;
    }
  }

  return out.slice(0, maxNames);
}

/** Same as {@link extractSubsidiaryNamesFromFilingForHints}; kept for existing imports. */
export function extractSubsidiaryNameHintsFromFilingText(rawText: string, maxNames = 25): string[] {
  return extractSubsidiaryNamesFromFilingForHints(rawText, maxNames);
}
