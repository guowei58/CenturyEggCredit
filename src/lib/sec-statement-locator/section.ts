import type { FilingSectionBounds, LocatorContext } from "./types";
import { tenQSectionHasFaceTrio } from "./faceProof";
import {
  ITEM1_START_PATTERN,
  ITEM8_START_PATTERNS,
  NOTES_HEADING_PATTERNS,
  TEN_Q_MIN_SECTION_CHARS,
  TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START,
  findFilteredNotesToFinancialStatementsStart,
  findPrimaryFaceTablesEndBeforeNotes,
  isLikelyFaceStatementFooterNotesReference,
  isLikelyStatementIndexListingHit,
  normalizeSpace,
} from "./signals";

function findAllMatchIndices(text: string, pattern: RegExp): number[] {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  const out: number[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m.index);
  return out;
}

function collectMatches(acc: string, patterns: RegExp[], minIndex: number): number[] {
  const out: number[] = [];
  for (const pattern of patterns) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (let m = re.exec(acc); m; m = re.exec(acc)) {
      if ((m.index ?? 0) >= minIndex) out.push(m.index);
    }
  }
  return out.sort((a, b) => a - b);
}

function partSectionSearchStart(acc: string, form: string): number {
  const re = form.includes("10-Q") ? /\bPART\s+I\b/gi : /\bPART\s+II\b/gi;
  const hits = findAllMatchIndices(acc, re);
  if (hits.length === 0) return 0;
  const earlyThreshold = form.includes("10-Q") ? 15_000 : 35_000;
  const minSkipGap = form.includes("10-Q") ? 5_000 : 8_000;
  if (
    hits.length >= 2 &&
    hits[0]! < earlyThreshold &&
    hits[1]! - hits[0]! >= minSkipGap &&
    hits[1]! - hits[0]! < 120_000
  ) {
    return hits[1] ?? hits[0]!;
  }
  return hits[0]!;
}

function isLikelyTocItemMarker(acc: string, offset: number, form: string): boolean {
  const preview = acc.slice(offset, Math.min(acc.length, offset + 900));
  const itemCount = (preview.match(/\bitem\s+\d+[a-z]?\b/gi) ?? []).length;
  if (itemCount >= 3) return true;
  if (/\btable\s+of\s+contents\b/i.test(preview)) return true;
  if (form.includes("10-Q")) {
    const back = acc.slice(Math.max(0, offset - 700), offset);
    if (/\btable\s+of\s+contents\b/i.test(back)) return true;
  }
  if (form.includes("10-K") && offset < 80_000 && /\bpart\s+iii\b/i.test(preview)) return true;
  return false;
}

function isLikelyTenQStatementIndexPreview(preview: string): boolean {
  const head = preview.slice(0, 12_000);
  // Real Item 1 face sections list IS/BS/CF tables — not a Part I TOC index with Item 2 on the same page.
  if (!/\bitem\s+2\b/i.test(head)) return false;
  if (
    /\b(?:statements?\s+of\s+operations|balance\s+sheets?|statements?\s+of\s+cash\s+flows?)\b[^.]{0,160}\(unaudited\)/i.test(
      head
    ) &&
    /\b(?:total\s+assets|net\s+revenu|operating\s+activities|cash\s+and\s+cash\s+equivalents)\b/i.test(head)
  ) {
    return false;
  }
  const t = head.toLowerCase();
  const indexLineHits = [
    /\b(?:consolidated\s+)?balance\s+sheets?\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
    /\bstatements?\s+of\s+operations\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
    /\bstatements?\s+of\s+cash\s+flows?\b[^.]{0,160}\(\s*unaudited\s*\)\s*\d{1,3}\b/,
  ].filter((re) => re.test(t)).length;
  return indexLineHits >= 2;
}

function isLikelyTenQPageRangeFinancialStatementsTocStart(acc: string, start: number): boolean {
  const early = acc.slice(start, Math.min(acc.length, start + 600));
  return /\bfinancial\s+statements\s+pages\s+\d/i.test(early);
}

function isLikelyTenQFinancialStatementsTocIndexStart(acc: string, start: number): boolean {
  if (isLikelyTenQPageRangeFinancialStatementsTocStart(acc, start)) return true;
  const back = acc.slice(Math.max(0, start - 1_000), start);
  if (/\btable\s+of\s+contents\b/i.test(back)) return true;
  const early = acc.slice(start, Math.min(acc.length, start + 2_800));
  if (/\(unaudited\)/i.test(early.slice(0, 2_000))) return false;
  return isLikelyTenQStatementIndexPreview(early);
}

function tenQStatementHeadingPreviewCues(preview: string): { hasIs: boolean; hasBs: boolean; hasCf: boolean } {
  const t = preview.toLowerCase();
  return {
    hasIs:
      /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+(?:operations|income|earnings)\b/.test(
        t
      ) || /\bconsolidated\s+income\s+statements?\b/.test(t),
    hasBs:
      /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+balance\s+sheets?\b/.test(t) ||
      /\bfinancial\s+position\b/.test(t),
    hasCf:
      /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+cash\s+flows?\b/.test(
        t
      ),
  };
}

function resolveTenQHeadingAnchoredItemStart(
  ctx: LocatorContext,
  acc: string
): { start: number; strategy: string } | null {
  const searchEnd = Math.min(acc.length, 200_000);
  const maxSpan = 55_000;
  const patterns: Record<"bs" | "is" | "cf", RegExp[]> = {
    bs: [/\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+balance\s+sheets?\b/gi],
    is: [
      /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+(?:statements?\s+of\s+(?:operations|income|earnings)|income\s+statements?)\b/gi,
    ],
    cf: [
      /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+cash\s+flows?\b/gi,
    ],
  };

  const hits = (kind: keyof typeof patterns) =>
    collectMatches(acc, patterns[kind], 0).filter((offset) => offset < searchEnd);

  const bsHits = hits("bs");
  const isHits = hits("is");
  const cfHits = hits("cf");
  if (bsHits.length === 0 || isHits.length === 0 || cfHits.length === 0) return null;

  let best: number | null = null;
  for (const bs of bsHits) {
    const is = isHits.find((offset) => offset >= bs - 5_000 && offset <= bs + maxSpan);
    const cf = cfHits.find((offset) => offset >= bs - 5_000 && offset <= bs + maxSpan);
    if (is == null || cf == null) continue;
    const start = Math.min(bs, is, cf);
    if (best == null || start < best) best = start;
  }
  if (best == null) return null;

  const end = findSectionEnd(acc, "10-Q", best);
  if (end - best < TEN_Q_MIN_SECTION_CHARS) return null;
  const scanEnd = Math.min(end, best + TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START);
  const preview = acc.slice(best, Math.min(end, best + 90_000));
  const cues = tenQStatementHeadingPreviewCues(preview);
  const trioProof =
    tenQSectionHasFaceTrio(ctx.$, ctx.tables, best, scanEnd) ||
    (cues.hasIs && cues.hasBs && cues.hasCf) ||
    (/\bbalance\s+sheets?\b/i.test(preview) &&
      /\bstatements?\s+of\s+(?:operations|income|cash\s+flows?)\b/i.test(preview));
  if (!trioProof) return null;
  return { start: best, strategy: "10q-heading-anchored-trio" };
}

function isLikelyTenQTocBoundaryHit(acc: string, sectionStart: number, hit: number): boolean {
  const gap = hit - sectionStart;
  if (gap > 12_000) return false;
  const window = acc.slice(sectionStart, Math.min(acc.length, hit + 250));
  const itemMarkers = window.match(/\bitem\s+\d+[a-z]?\b/gi) ?? [];
  if (itemMarkers.length >= 2) return true;
  if (/\bpage\b/i.test(acc.slice(sectionStart, sectionStart + 600))) return true;
  const hitPreview = acc.slice(hit, Math.min(acc.length, hit + 160));
  if (/\bpart\s+ii\b/i.test(hitPreview) && /\bother\s+information\b/i.test(hitPreview)) return true;
  return false;
}

function findSectionEnd(acc: string, form: string, start: number): number {
  const patterns = form.includes("10-Q")
    ? [
        /\bITEM\s+2[\.\u2014\u2013\-]?\s*MANAGEMENT[\u2019']?S\s+DISCUSSION\b/gi,
        /\bPART\s+II\b/gi,
      ]
    : [
        /\bITEM\s+9[\.\u2014\u2013\-]?\s*CHANGES\b/gi,
        /\bITEM\s+9A[\.\u2014\u2013\-]?\s*CONTROLS\b/gi,
        /\bSIGNATURES?\b/gi,
      ];
  const hits = collectMatches(acc, patterns, start + 200);
  if (form.includes("10-Q")) {
    const valid = hits.filter((hit) => !isLikelyTenQTocBoundaryHit(acc, start, hit));
    return valid[0] ?? acc.length;
  }
  return hits[0] ?? acc.length;
}

function resolveItemStart(acc: string, form: string): { start: number | null; strategy: string } {
  const normalized = form.toUpperCase();
  const searchStart = partSectionSearchStart(acc, normalized);
  const patterns = normalized.includes("10-Q") ? [ITEM1_START_PATTERN] : ITEM8_START_PATTERNS;
  const itemStarts = collectMatches(acc, patterns, searchStart);

  if (normalized.includes("10-K")) {
    const bodyAnchorHits = collectMatches(
      acc,
      [/\bindex\s+to\s+consolidated\s+financial\s+statements\b/gi, /\breport\s+of\s+independent\s+registered\b/gi],
      searchStart
    );
    const bodyAnchor = bodyAnchorHits[0] ?? null;
    const filtered = itemStarts.filter((start) => !isLikelyTocItemMarker(acc, start, normalized));
    const candidates = filtered.length ? filtered : itemStarts;
    if (bodyAnchor != null) {
      const nearBody = candidates.filter((start) => start >= bodyAnchor - 2_000 && start <= bodyAnchor + 20_000);
      if (nearBody.length > 0) return { start: nearBody[0]!, strategy: "10k-item8-near-body" };
    }
    const pick = candidates[candidates.length - 1] ?? itemStarts[itemStarts.length - 1] ?? null;
    return { start: pick, strategy: pick != null ? "10k-item8" : "none" };
  }

  return { start: null, strategy: "none" };
}

function resolveTenQItemStart(
  ctx: LocatorContext,
  acc: string
): { start: number | null; strategy: string } {
  const searchStart = partSectionSearchStart(acc, "10-Q");
  const itemStarts = collectMatches(acc, [ITEM1_START_PATTERN], searchStart);

  let bestItem: { start: number; strategy: string } | null = null;

  for (let idx = 0; idx < itemStarts.length; idx += 1) {
    const start = itemStarts[idx]!;
    if (isLikelyTenQPageRangeFinancialStatementsTocStart(acc, start)) continue;
    if (isLikelyTenQFinancialStatementsTocIndexStart(acc, start)) continue;
    const end = findSectionEnd(acc, "10-Q", start);
    if (end - start < TEN_Q_MIN_SECTION_CHARS) continue;

    const scanEnd = Math.min(
      end,
      start + TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START,
      primaryStatementsCeiling(acc, { start, end })
    );
    if (!tenQSectionHasFaceTrio(ctx.$, ctx.tables, start, scanEnd)) continue;
    // Trio-proof overrides TOC-looking Item 1 lines that precede embedded face tables (MAGN-style).
    if (isLikelyTocItemMarker(acc, start, "10-Q")) {
      const preview = acc.slice(start, Math.min(end, start + 15_000));
      const cues = tenQStatementHeadingPreviewCues(preview);
      if (!cues.hasIs && !cues.hasBs && !cues.hasCf) continue;
      if (isLikelyTenQStatementIndexPreview(preview)) continue;
    }

    const preview = acc.slice(start, Math.min(end, start + 15_000));
    const cues = tenQStatementHeadingPreviewCues(preview);
    const hasBodyFaceHeading =
      /\b(?:statements?\s+of\s+(?:operations|income)|balance\s+sheets?|statements?\s+of\s+cash\s+flows?)\b[^.]{0,160}\(unaudited\)/i.test(
        preview
      );
    const bodyFaceHeading =
      /\b(?:statements?\s+of\s+(?:operations|income)|balance\s+sheets?|statements?\s+of\s+cash\s+flows?)\b[^.]{0,160}\(unaudited\)/i.test(
        preview
      ) && !isLikelyTenQStatementIndexPreview(preview);
    const strategy =
      bodyFaceHeading || (cues.hasIs && cues.hasBs && cues.hasCf)
        ? "10q-item1-trio-proof-with-headings"
        : "10q-item1-trio-proof";
    if (
      bodyFaceHeading ||
      (cues.hasIs && cues.hasBs && cues.hasCf && !isLikelyTenQStatementIndexPreview(preview)) ||
      (!isLikelyTocItemMarker(acc, start, "10-Q") && !isLikelyTenQStatementIndexPreview(preview))
    ) {
      if (!bestItem || start < bestItem.start) bestItem = { start, strategy };
    }
  }

  const heading = resolveTenQHeadingAnchoredItemStart(ctx, acc);
  if (heading && (!bestItem || heading.start < bestItem.start)) return heading;
  if (bestItem) return bestItem;

  const notesStart = findFilteredNotesToFinancialStatementsStart(acc, 1_800);
  if (notesStart != null) {
    const lookback = Math.max(1_800, notesStart - 90_000);
    const preview = acc.slice(lookback, notesStart);
    const cues = tenQStatementHeadingPreviewCues(preview);
    const scanEnd = Math.min(notesStart, lookback + TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START);
    const hasFaceEvidence =
      (cues.hasIs && cues.hasBs && cues.hasCf) ||
      tenQSectionHasFaceTrio(ctx.$, ctx.tables, lookback, scanEnd) ||
      (/\bbalance\s+sheets?\b/i.test(preview) &&
        /\bstatements?\s+of\s+(?:operations|income|cash\s+flows?)\b/i.test(preview));
    if (hasFaceEvidence) {
      const end = findSectionEnd(acc, "10-Q", lookback);
      if (end > lookback + 2_000) {
        return { start: lookback, strategy: "10q-notes-preceding-face" };
      }
    }
  }

  return { start: null, strategy: "none" };
}

function isTenKItem8IncorporatedByReference(acc: string, item8Start: number): boolean {
  const preview = acc.slice(item8Start, Math.min(acc.length, item8Start + 4_000));
  if (!/\bincorporat(?:ed|ion)\b/i.test(preview)) return false;
  return /\bpart\s+iv\b/i.test(preview) || /\bitem\s+15\b/i.test(preview);
}

function findTenKPartIvSection(acc: string, item8Start: number): FilingSectionBounds | null {
  const partIvHits = collectMatches(acc, [/\bPART\s+IV\b/gi], item8Start).filter((p) => p >= item8Start);
  let best: { start: number; score: number } | null = null;
  for (const partStart of partIvHits) {
    const window = acc.slice(partStart, Math.min(acc.length, partStart + 30_000));
    const cues = tenQStatementHeadingPreviewCues(window);
    if (!cues.hasIs || !cues.hasBs || !cues.hasCf) continue;
    const score =
      30 +
      (/\breport\s+of\s+independent\b/i.test(window) ? 50 : 0) +
      (/\bconsolidated\s+statements?\s+of\s+operations\b/i.test(window) ? 40 : 0);
    if (!best || score > best.score) best = { start: partStart, score };
  }
  if (best) return { start: best.start, end: acc.length };
  const lastPartIv = partIvHits[partIvHits.length - 1];
  if (lastPartIv != null) return { start: lastPartIv, end: acc.length };
  return null;
}

function firstTenQCashFlowHeadingOffset(acc: string, section: FilingSectionBounds): number | null {
  const pattern =
    /\b(?:condensed\s+consolidated|consolidated\s+condensed|consolidated)\s+statements?\s+of\s+cash\s+flows?\b/gi;
  const hits = collectMatches(acc, [pattern], section.start).filter(
    (offset) =>
      offset < section.end && !isLikelyStatementIndexListingHit(acc, offset)
  );
  return hits[0] ?? null;
}

function primaryStatementsCeiling(acc: string, section: FilingSectionBounds): number {
  const cfHeading = firstTenQCashFlowHeadingOffset(acc, section);
  const notesSearchStart = cfHeading != null ? cfHeading + 200 : section.start + 800;
  return findPrimaryFaceTablesEndBeforeNotes(acc, section.start, section.end, notesSearchStart);
}

/** Identify the expected financial-statements section for 10-Q Item 1 or 10-K Item 8 (incl. Part IV exhibits). */
export function locateFinancialStatementsSection(
  ctx: LocatorContext,
  form: string
): { section: FilingSectionBounds; strategy: string; scanCeiling: number } | null {
  const normalized = form.toUpperCase();
  const { start, strategy } = normalized.includes("10-Q")
    ? resolveTenQItemStart(ctx, ctx.acc)
    : resolveItemStart(ctx.acc, normalized);
  if (start == null) return null;

  if (normalized.includes("10-K") && isTenKItem8IncorporatedByReference(ctx.acc, start)) {
    const partIv = findTenKPartIvSection(ctx.acc, start);
    if (partIv) {
      const sectionLen = partIv.end - partIv.start;
      const largeExhibit = sectionLen > 60_000;
      const scanCeiling = Math.min(
        partIv.end,
        partIv.start + (largeExhibit ? 140_000 : 120_000)
      );
      return { section: partIv, strategy: "10k-part-iv-exhibit", scanCeiling };
    }
  }

  const end = findSectionEnd(ctx.acc, normalized, start);
  if (end <= start) return null;
  const section = { start, end };
  const sectionLen = section.end - section.start;
  const notesCeiling = primaryStatementsCeiling(ctx.acc, section);

  if (normalized.includes("10-Q")) {
    const scanCeiling = Math.min(
      end,
      section.start + TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START,
      notesCeiling
    );
    return { section, strategy, scanCeiling };
  }

  const dynamicCeiling = Math.min(end, start + (sectionLen > 60_000 ? 140_000 : 120_000));
  const scanCeiling = Math.min(Math.max(dynamicCeiling, Math.min(notesCeiling, end)), end);
  return { section, strategy, scanCeiling };
}

export function extractHeadingBeforeOffset(acc: string, offset: number, lookback = 1_400): string {
  const start = Math.max(0, offset - lookback);
  const raw = acc.slice(start, offset);
  const chunks = raw.split(/\s{2,}|\n/).map((c) => normalizeSpace(c)).filter(Boolean);
  return chunks.slice(-4).join(" ");
}
