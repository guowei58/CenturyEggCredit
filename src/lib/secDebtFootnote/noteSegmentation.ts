/**
 * Financial-statement note segmentation for EDGAR HTML (10-K / 10-Q primary documents).
 *
 * Pipeline: visible block stream → Notes region → standalone heading detection → cluster selection
 * → canonical non-overlapping note blocks → validation. Debt classification must consume these blocks only.
 */

export type VisibleBlock = {
  block_id: string;
  source_id: string;
  text: string;
  normalized_text: string;
  html_tag: string;
  dom_path: string;
  visible: boolean;
  is_table_cell: boolean;
  is_heading_like: boolean;
  has_bold_or_strong_style: boolean;
  start_offset: number;
  end_offset: number;
};

export type CanonicalNoteBlock = {
  note_number: string;
  exact_heading: string;
  normalized_heading: string;
  source_id: string;
  heading_start_offset: number;
  heading_end_offset: number;
  start_offset: number;
  end_offset: number;
  body_text: string;
  body_html: string;
  tables: string[];
  body_block_ids: string[];
};

export type FootnoteSegmentationDiagnostic = {
  filingFormUsed: "10-K" | "10-Q";
  itemFloorFound: boolean;
  itemFloorKind: string;
  notesSectionFound: boolean;
  notesSectionStartOffset: number | null;
  headingCandidatesRaw: number;
  acceptedTopLevelHeadings: number;
  rejectedCandidates: Array<{ text: string; reason: string }>;
  acceptedSequence: string[];
  monotonicOk: boolean;
  tocClusterRejected: boolean;
  embeddedHeadingCheckNotes: string[];
  segmentationConfidence: "high" | "medium" | "low";
  warnings: string[];
};

export type FootnoteSegmentationResult = {
  ok: boolean;
  segmentation_failed: boolean;
  failure_reason?: string;
  blocks: VisibleBlock[];
  note_blocks: CanonicalNoteBlock[];
  diagnostic: FootnoteSegmentationDiagnostic;
};

export type SegmentFootnotesContext = {
  formType: "10-K" | "10-Q";
  regionStart: number;
  regionEnd: number;
  notesStart: number;
  notesSectionFound: boolean;
  itemFloorFound: boolean;
  itemFloorKind: string;
};

const SOURCE_PRIMARY_HTML = "primary_html";

function collapseWs(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function normalizePlain(s: string): string {
  return collapseWs(s.replace(/\u00a0/g, " ")).toLowerCase();
}

function stripTags(html: string): string {
  return collapseWs(html.replace(/<[^>]+>/g, " "));
}

function isAttrsHidden(attrs: string): boolean {
  const a = attrs.toLowerCase();
  if (/\bhidden\b/i.test(a)) return true;
  if (/display\s*:\s*none/i.test(a)) return true;
  if (/visibility\s*:\s*hidden/i.test(a)) return true;
  if (/\bix:\s*hidden\b/i.test(a)) return true;
  return false;
}

function hasBoldOrStrong(inner: string, attrs: string): boolean {
  if (/<(?:b|strong)\b/i.test(inner)) return true;
  if (/font-weight\s*:\s*(?:bold|700)/i.test(attrs)) return true;
  if (/font-weight\s*:\s*(?:bold|700)/i.test(inner)) return true;
  return false;
}

/** Dot-leaders / TOC lines */
function looksLikeTocLine(text: string): boolean {
  const t = text.trim();
  if (/\.{4,}/.test(t)) return true;
  if (/\s\d{1,4}\s*$/.test(t) && /\.{2,}/.test(t)) return true;
  return false;
}

function looksLikePageNumberTail(text: string): boolean {
  return /\s\d{1,4}\s*$/.test(text.trim()) && text.length < 120;
}

function isCrossReferenceProse(text: string): boolean {
  const t = text.trim();
  if (/^see\s+note\b/i.test(t)) return true;
  if (/\brefer(?:\s+to)?\s+note\b/i.test(t.slice(0, 80))) return true;
  if (/^note\s+\d+\s+to\s+(?:the\s+|our\s+)?(?:consolidated\s+)?financial\s+statements\b/i.test(t)) return true;
  return false;
}

export type ParsedStandaloneHeading = {
  note_number: string;
  title: string;
};

/**
 * Match heading patterns only against standalone block plain text (single-line preference).
 */
export function parseStandaloneNoteHeading(text: string): ParsedStandaloneHeading | null {
  let t = collapseWs(stripTags(text)).trim();
  /* EDGAR / Word often uses Unicode dashes (U+2013/U+2014) — normalize for deterministic regex matching. */
  t = t.replace(/\u2013|\u2014|\u2015/g, "-");
  if (!t || t.length > 180) return null;
  if (looksLikeTocLine(t)) return null;
  if (looksLikePageNumberTail(t) && /.{40,}/.test(t)) return null;
  if (isCrossReferenceProse(t)) return null;

  let m =
    /^\s*Note\s+(\d{1,2}[A-Z]?)\s*[\.\-—:)]?\s*(.{1,150})\s*$/i.exec(t) ||
    /^\s*NOTE\s+(\d{1,2}[A-Z]?)\s+(.{1,150})\s*$/i.exec(t);
  if (m) {
    return { note_number: (m[1] ?? "").trim(), title: (m[2] ?? "").trim().replace(/^[\.\-—:\)]+\s*/, "") };
  }
  m = /^\s*(\d{1,2}[A-Z]?)\s*[\.\-—:]\s+(.{1,150})\s*$/.exec(t);
  if (m && /^[A-Za-z]/.test((m[2] ?? "").trim())) {
    return { note_number: (m[1] ?? "").trim(), title: (m[2] ?? "").trim() };
  }
  return null;
}

type RawBlock = {
  tag: string;
  attrs: string;
  innerHtml: string;
  start: number;
  end: number;
  domPath: string;
  isTableCell: boolean;
};

function extractRawBlocks(html: string, notesStart: number, regionEnd: number): RawBlock[] {
  const slice = html.slice(notesStart, Math.min(regionEnd, html.length));
  const out: RawBlock[] = [];

  const pushMatches = (re: RegExp, tag: string, domBase: string, isTd: boolean) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) {
      const attrs = m[1] ?? "";
      const inner = m[2] ?? "";
      const absStart = notesStart + m.index;
      const absEnd = notesStart + m.index + m[0].length;
      if (isAttrsHidden(attrs)) continue;
      out.push({
        tag,
        attrs,
        innerHtml: inner,
        start: absStart,
        end: absEnd,
        domPath: domBase,
        isTableCell: isTd,
      });
    }
  };

  pushMatches(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, "p", "notes>p", false);
  pushMatches(/<div\b([^>]*)>([\s\S]*?)<\/div>/gi, "div", "notes>div", false);
  pushMatches(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi, "td", "notes>table>td", true);
  pushMatches(/<th\b([^>]*)>([\s\S]*?)<\/th>/gi, "th", "notes>table>th", true);

  out.sort((a, b) => a.start - b.start);
  return out;
}

function blockLooksStandalone(innerHtml: string, plain: string): boolean {
  if (plain.length > 220) return false;
  if (/<\s*(?:p|div|table)\b/i.test(innerHtml)) return false;
  return true;
}

export function buildVisibleBlockStream(html: string, notesStart: number, regionEnd: number): VisibleBlock[] {
  const raws = extractRawBlocks(html, notesStart, regionEnd);
  const blocks: VisibleBlock[] = [];
  let id = 0;
  for (const r of raws) {
    const plain = stripTags(r.innerHtml);
    const nb = normalizePlain(plain);
    const headingTry = parseStandaloneNoteHeading(r.innerHtml);
    const visible = !isAttrsHidden(r.attrs);
    blocks.push({
      block_id: `b_${id++}`,
      source_id: SOURCE_PRIMARY_HTML,
      text: plain,
      normalized_text: nb,
      html_tag: r.tag,
      dom_path: r.domPath,
      visible,
      is_table_cell: r.isTableCell,
      is_heading_like: headingTry !== null && blockLooksStandalone(r.innerHtml, plain),
      has_bold_or_strong_style: hasBoldOrStrong(r.innerHtml, r.attrs),
      start_offset: r.start,
      end_offset: r.end,
    });
  }
  return blocks;
}

type HeadingCandidate = {
  note_number: string;
  exact_heading: string;
  heading_start: number;
  heading_end: number;
  block_id: string;
  plain_title: string;
  /** Gap from previous accepted heading’s block end (chars of HTML) — filled later */
  gapFromPrevHtml?: number;
};

function collectHeadingCandidates(blocks: VisibleBlock[]): { accepted: HeadingCandidate[]; rejected: Array<{ text: string; reason: string }> } {
  const accepted: HeadingCandidate[] = [];
  const rejected: Array<{ text: string; reason: string }> = [];

  for (const b of blocks) {
    if (!b.visible) continue;
    if (b.is_table_cell && b.text.length > 140) {
      rejected.push({ text: b.text.slice(0, 120), reason: "table_cell_body_too_long_for_heading" });
      continue;
    }
    if (!b.is_heading_like) continue;
    const parsed = parseStandaloneNoteHeading(b.text);
    if (!parsed) continue;
    if (b.is_table_cell && !b.has_bold_or_strong_style) {
      rejected.push({ text: b.text.slice(0, 120), reason: "table_cell_without_strong_heading_style" });
      continue;
    }
    const exactHeading = collapseWs(stripTags(`Note ${parsed.note_number} ${parsed.title}`));
    accepted.push({
      note_number: parsed.note_number,
      exact_heading: exactHeading,
      heading_start: b.start_offset,
      heading_end: b.end_offset,
      block_id: b.block_id,
      plain_title: parsed.title,
    });
  }

  return { accepted, rejected };
}

function parseNoteNum(s: string): number {
  const n = parseInt(s.replace(/[^\d]/g, ""), 10);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Split heading candidates into clusters when numbering resets (e.g. TOC Note 13 then body Note 1).
 */
function clusterHeadingRuns(candidates: HeadingCandidate[]): HeadingCandidate[][] {
  const sorted = [...candidates].sort((a, b) => a.heading_start - b.heading_start);
  const clusters: HeadingCandidate[][] = [];
  let cur: HeadingCandidate[] = [];
  let prevNum = NaN;

  for (const c of sorted) {
    const n = parseNoteNum(c.note_number);
    if (cur.length === 0) {
      cur.push(c);
      prevNum = n;
      continue;
    }
    const restart =
      (Number.isFinite(prevNum) &&
        Number.isFinite(n) &&
        prevNum >= 10 &&
        n <= 5 &&
        prevNum > n + 3) ||
      (Number.isFinite(prevNum) && Number.isFinite(n) && n < prevNum && prevNum - n >= 5);
    if (restart) {
      clusters.push(cur);
      cur = [c];
      prevNum = n;
      continue;
    }
    cur.push(c);
    prevNum = n;
  }
  if (cur.length) clusters.push(cur);
  return clusters;
}

function medianGapHtml(html: string, heads: HeadingCandidate[]): number {
  if (heads.length < 2) return 10_000;
  const gaps: number[] = [];
  const sorted = [...heads].sort((a, b) => a.heading_start - b.heading_start);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const cur = sorted[i]!;
    gaps.push(Math.max(0, cur.heading_start - prev.heading_end));
  }
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

/** True when the HTML between two headings is clearly substantive (not a TOC row gap). */
function gapLooksLikeSubstantiveBody(htmlSlice: string): boolean {
  if (/<table\b/i.test(htmlSlice)) return true;
  const plain = stripTags(htmlSlice);
  if (plain.length >= 320) return true;
  return false;
}

function medianGapNoteBlocks(noteBlocks: CanonicalNoteBlock[]): number {
  const heads = noteBlocks.map((nb) => ({
    note_number: nb.note_number,
    exact_heading: nb.exact_heading,
    heading_start: nb.heading_start_offset,
    heading_end: nb.heading_end_offset,
    block_id: nb.body_block_ids[0] ?? "x",
    plain_title: nb.exact_heading,
  }));
  return medianGapHtml("", heads);
}

function clusterLooksLikeToc(heads: HeadingCandidate[], html: string): boolean {
  if (heads.length < 3) return false;
  const sorted = [...heads].sort((a, b) => a.heading_start - b.heading_start);
  let shortBody = 0;
  for (let i = 1; i < sorted.length; i++) {
    const prevEnd = sorted[i - 1]!.heading_end;
    const curStart = sorted[i]!.heading_start;
    const g = Math.max(0, curStart - prevEnd);
    const slice = html.slice(prevEnd, curStart);
    if (g < 200 && !gapLooksLikeSubstantiveBody(slice)) shortBody++;
  }
  const medGap = medianGapHtml(html, heads);
  /* Very dense clusters with many headings behave like a TOC; short footnote runs stay exempt. */
  if (heads.length >= 8 && medGap < 100) return true;
  return shortBody >= Math.ceil(heads.length * 0.55);
}

/** Penalize implausible jumps (e.g. Note 1 → Note 13) that usually mix TOC rows with real notes. */
function clusterNoteNumberJumpPenalty(heads: HeadingCandidate[]): number {
  const sorted = [...heads].sort((a, b) => a.heading_start - b.heading_start);
  let pen = 0;
  for (let i = 1; i < sorted.length; i++) {
    const a = parseNoteNum(sorted[i - 1]!.note_number);
    const b = parseNoteNum(sorted[i]!.note_number);
    if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
    const d = b - a;
    if (d > 3) pen += (d - 3) * 14;
  }
  return pen;
}

function scoreCluster(html: string, heads: HeadingCandidate[]): number {
  if (heads.length === 0) return -1e9;
  const sorted = [...heads].sort((a, b) => a.heading_start - b.heading_start);
  const firstN = parseNoteNum(sorted[0]!.note_number);
  let mono = 0;
  let prev = firstN;
  for (const h of sorted) {
    const n = parseNoteNum(h.note_number);
    if (Number.isFinite(n) && Number.isFinite(prev) && n >= prev - 1) mono++;
    prev = n;
  }
  const startBonus = Number.isFinite(firstN) && firstN <= 3 ? 80 : 0;
  const lenScore = sorted.length * 25;
  const gapScore = Math.min(medianGapHtml(html, sorted) / 15, 80);
  const tocPen = clusterLooksLikeToc(sorted, html) ? -250 : 0;
  const jumpPen = clusterNoteNumberJumpPenalty(sorted);
  return lenScore + startBonus + gapScore + mono * 6 + tocPen - jumpPen;
}

function pickBestCluster(html: string, clusters: HeadingCandidate[][]): { picked: HeadingCandidate[]; tocRejected: boolean } {
  let best: HeadingCandidate[] = [];
  let bestScore = -1e9;
  let tocRejected = false;
  for (const cl of clusters) {
    if (clusterLooksLikeToc(cl, html)) tocRejected = true;
    const sc = scoreCluster(html, cl);
    if (sc > bestScore) {
      bestScore = sc;
      best = cl;
    }
  }
  return { picked: best.sort((a, b) => a.heading_start - b.heading_start), tocRejected };
}

function sequenceMonotonic(heads: HeadingCandidate[]): boolean {
  const nums = heads.map((h) => parseNoteNum(h.note_number)).filter((n) => Number.isFinite(n));
  if (nums.length < 2) return true;
  let bad = 0;
  for (let i = 1; i < nums.length; i++) {
    if ((nums[i] as number) < (nums[i - 1] as number) - 1) bad++;
  }
  return bad <= Math.max(1, Math.floor(nums.length * 0.15));
}

export function extractTablesFromHtml(htmlChunk: string): string[] {
  const tables: string[] = [];
  const re = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(htmlChunk)) !== null) {
    tables.push(m[0]);
  }
  return tables;
}

function nextHeadingStartAfter(pos: number, allSorted: HeadingCandidate[]): number | null {
  for (const h of allSorted) {
    if (h.heading_start > pos) return h.heading_start;
  }
  return null;
}

function buildCanonicalBlocks(
  html: string,
  heads: HeadingCandidate[],
  regionEnd: number,
  allHeadingBoundaries: HeadingCandidate[],
): CanonicalNoteBlock[] {
  const boundaries = [...allHeadingBoundaries].sort((a, b) => a.heading_start - b.heading_start);
  const sorted = [...heads].sort((a, b) => a.heading_start - b.heading_start);
  const cap = Math.min(regionEnd, html.length);
  const out: CanonicalNoteBlock[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const h = sorted[i]!;
    const start_offset = h.heading_start;
    const nextGlobal = nextHeadingStartAfter(h.heading_start, boundaries);
    const end_offset = nextGlobal !== null ? Math.min(nextGlobal, cap) : cap;
    const slice = html.slice(start_offset, end_offset);
    const body_html = slice;
    const body_text = stripTags(slice);
    out.push({
      note_number: h.note_number,
      exact_heading: h.exact_heading,
      normalized_heading: normalizePlain(h.exact_heading),
      source_id: SOURCE_PRIMARY_HTML,
      heading_start_offset: h.heading_start,
      heading_end_offset: h.heading_end,
      start_offset,
      end_offset,
      body_text,
      body_html,
      tables: extractTablesFromHtml(slice),
      body_block_ids: [h.block_id],
    });
  }
  return out;
}

export function plainFromFootnoteSliceHtml(html: string): string {
  return html
    .replace(/<\/p>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Line-leading note headings inside plain body (approximates printed top-level headings). */
export function extractLineLeadingNoteNumbers(plain: string): number[] {
  const lines = plain.split(/\r?\n|\u2028/u);
  const found: number[] = [];
  for (const line of lines) {
    const t = line.trim();
    const m1 = /^(?:Note|NOTE)\s+(\d{1,2}[A-Z]?)\b/.exec(t);
    const m2 = /^(\d{1,2}[A-Z]?)\s*[\.\-—]\s+[A-Za-z]/.exec(t);
    const raw = m1?.[1] ?? m2?.[1];
    if (raw) {
      const n = parseInt(raw.replace(/[^\d]/g, ""), 10);
      if (Number.isFinite(n)) found.push(n);
    }
  }
  return found;
}

/**
 * STEP 11 — selected heading Note K but body embeds multiple earlier top-level headings.
 */
export function selectedBodyContainsMultipleEarlierTopLevelHeadings(
  selectedNoteNum: string,
  sliceHtml: string,
): { failed: boolean; embeddedEarlier: number[] } {
  const sel = parseInt(selectedNoteNum.replace(/[^\d]/g, ""), 10);
  if (!Number.isFinite(sel) || sel < 8) return { failed: false, embeddedEarlier: [] };
  const plain = plainFromFootnoteSliceHtml(sliceHtml);
  const nums = extractLineLeadingNoteNumbers(plain);
  const earlier = [...new Set(nums.filter((n) => n > 0 && n < sel))].sort((a, b) => a - b);
  const maxEarlier = earlier[earlier.length - 1] ?? 0;
  if (earlier.length >= 3 && earlier[0] <= 2 && maxEarlier <= Math.min(sel - 1, 8)) {
    return { failed: true, embeddedEarlier: earlier };
  }
  /* Two early notes inside a high-number slice (e.g. mis-bound Note 13 containing Notes 2 and 4). */
  if (
    sel >= 10 &&
    earlier.length >= 2 &&
    earlier[0] <= 3 &&
    maxEarlier <= Math.min(sel - 1, 10)
  ) {
    return { failed: true, embeddedEarlier: earlier };
  }
  return { failed: false, embeddedEarlier: earlier };
}

export function validateNoteMap(noteBlocks: CanonicalNoteBlock[], _html: string): {
  ok: boolean;
  reasons: string[];
  softWarnings: string[];
  embeddedIssues: string[];
} {
  const reasons: string[] = [];
  const softWarnings: string[] = [];
  const embeddedIssues: string[] = [];
  if (noteBlocks.length < 2) {
    reasons.push("fewer_than_two_notes");
    return { ok: false, reasons, softWarnings, embeddedIssues };
  }

  for (let i = 0; i < noteBlocks.length; i++) {
    const nb = noteBlocks[i]!;
    if (nb.start_offset >= nb.end_offset) reasons.push(`bad_offsets_${nb.note_number}`);
    if (i > 0 && nb.start_offset < noteBlocks[i - 1]!.end_offset - 4) {
      reasons.push(`overlap_${noteBlocks[i - 1]!.note_number}_${nb.note_number}`);
    }
    const emb = selectedBodyContainsMultipleEarlierTopLevelHeadings(nb.note_number, nb.body_html);
    if (emb.failed) {
      embeddedIssues.push(`note_${nb.note_number}_embeds_${emb.embeddedEarlier.join(",")}`);
    }
  }

  const nums = noteBlocks.map((n) => parseNoteNum(n.note_number)).filter(Number.isFinite);
  let nonMono = 0;
  for (let i = 1; i < nums.length; i++) {
    if ((nums[i] as number) < (nums[i - 1] as number) - 1) nonMono++;
  }
  if (nonMono > Math.max(1, Math.floor(nums.length * 0.2))) {
    reasons.push("sequence_not_monotonic");
  }

  const medGap = medianGapNoteBlocks(noteBlocks);
  if (medGap < 90 && noteBlocks.length >= 5) {
    softWarnings.push("median_gap_suggests_toc");
  }

  const ok = reasons.length === 0 && embeddedIssues.length === 0;
  return { ok, reasons, softWarnings, embeddedIssues };
}

/**
 * Main entry: segment notes inside primary HTML after Notes header region.
 */
export function segmentFootnotesForDebtExtraction(html: string, ctx: SegmentFootnotesContext): FootnoteSegmentationResult {
  const warnings: string[] = [];
  const rejectedLog: Array<{ text: string; reason: string }> = [];

  const blocks = buildVisibleBlockStream(html, ctx.notesStart, ctx.regionEnd);
  const { accepted: rawHeadings, rejected } = collectHeadingCandidates(blocks);
  rejectedLog.push(...rejected);

  if (rawHeadings.length === 0) {
    const diag: FootnoteSegmentationDiagnostic = {
      filingFormUsed: ctx.formType,
      itemFloorFound: ctx.itemFloorFound,
      itemFloorKind: ctx.itemFloorKind,
      notesSectionFound: ctx.notesSectionFound,
      notesSectionStartOffset: ctx.notesSectionFound ? ctx.notesStart : null,
      headingCandidatesRaw: 0,
      acceptedTopLevelHeadings: 0,
      rejectedCandidates: rejectedLog.slice(0, 80),
      acceptedSequence: [],
      monotonicOk: false,
      tocClusterRejected: false,
      embeddedHeadingCheckNotes: [],
      segmentationConfidence: "low",
      warnings: ["no_standalone_note_heading_blocks"],
    };
    return {
      ok: false,
      segmentation_failed: true,
      failure_reason: "No standalone note-heading blocks detected in Notes region.",
      blocks,
      note_blocks: [],
      diagnostic: diag,
    };
  }

  const clusters = clusterHeadingRuns(rawHeadings);
  const { picked, tocRejected } = pickBestCluster(html, clusters);
  const boundaryHeadings = [...rawHeadings].sort((a, b) => a.heading_start - b.heading_start);
  const noteBlocks = buildCanonicalBlocks(html, picked, ctx.regionEnd, boundaryHeadings);
  const validation = validateNoteMap(noteBlocks, html);
  warnings.push(...validation.softWarnings);

  const monotonicOk = sequenceMonotonic(picked);

  let segmentationConfidence: FootnoteSegmentationDiagnostic["segmentationConfidence"] = "high";
  if (!validation.ok || !monotonicOk || picked.length < 3) segmentationConfidence = "medium";
  if (picked.length < 2 || validation.embeddedIssues.length > 0) segmentationConfidence = "low";

  const diag: FootnoteSegmentationDiagnostic = {
    filingFormUsed: ctx.formType,
    itemFloorFound: ctx.itemFloorFound,
    itemFloorKind: ctx.itemFloorKind,
    notesSectionFound: ctx.notesSectionFound,
    notesSectionStartOffset: ctx.notesSectionFound ? ctx.notesStart : null,
    headingCandidatesRaw: rawHeadings.length,
    acceptedTopLevelHeadings: picked.length,
    rejectedCandidates: rejectedLog.slice(0, 80),
    acceptedSequence: picked.map((p) => `Note ${p.note_number}`),
    monotonicOk,
    tocClusterRejected: tocRejected,
    embeddedHeadingCheckNotes: validation.embeddedIssues,
    segmentationConfidence,
    warnings,
  };

  if (validation.embeddedIssues.length) {
    warnings.push(`Embedded headings inside segmented notes: ${validation.embeddedIssues.join("; ")}`);
  }
  if (!validation.ok) {
    warnings.push(`Note map validation: ${validation.reasons.join("; ")}`);
  }

  const ok =
    picked.length >= 2 &&
    validation.embeddedIssues.length === 0 &&
    segmentationConfidence !== "low" &&
    validation.reasons.length === 0;

  const segmentation_failed = !ok;

  return {
    ok,
    segmentation_failed,
    failure_reason: segmentation_failed
      ? "Canonical note map failed validation — use fallbacks or legacy scanner."
      : undefined,
    blocks,
    note_blocks: ok ? noteBlocks : [],
    diagnostic: diag,
  };
}
