import type { FilingSectionBounds, LocatorContext } from "./types";
import {
  ITEM1_START_PATTERN,
  ITEM8_START_PATTERNS,
  NOTES_HEADING_PATTERNS,
  TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START,
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
  if (form.includes("10-K") && offset < 80_000 && /\bpart\s+iii\b/i.test(preview)) return true;
  return false;
}

function tenQStatementHeadingPreviewCues(preview: string): { hasIs: boolean; hasBs: boolean; hasCf: boolean } {
  const t = preview.toLowerCase();
  return {
    hasIs: /\bstatements?\s+of\s+(?:operations|income|earnings)\b/.test(t),
    hasBs: /\bbalance\s+sheets?\b/.test(t) || /\bfinancial\s+position\b/.test(t),
    hasCf: /\bstatements?\s+of\s+cash\s+flows?\b/.test(t),
  };
}

function findSectionEnd(acc: string, form: string, start: number): number {
  const patterns = form.includes("10-Q")
    ? [/\bITEM\s+2[\.\u2014\u2013\-]?\s*MANAGEMENT'?S\s+DISCUSSION\b/gi, /\bPART\s+II\b/gi]
    : [
        /\bITEM\s+9[\.\u2014\u2013\-]?\s*CHANGES\b/gi,
        /\bITEM\s+9A[\.\u2014\u2013\-]?\s*CONTROLS\b/gi,
        /\bSIGNATURES?\b/gi,
      ];
  const hits = collectMatches(acc, patterns, start + 200);
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

  for (let idx = 0; idx < itemStarts.length; idx += 1) {
    const start = itemStarts[idx]!;
    if (isLikelyTocItemMarker(acc, start, normalized)) continue;
    const nextItem = itemStarts[idx + 1] ?? acc.length;
    const preview = acc.slice(start, Math.min(nextItem, start + 15_000));
    const cues = tenQStatementHeadingPreviewCues(preview);
    if (cues.hasIs && cues.hasBs && cues.hasCf) return { start, strategy: "10q-item1-with-headings" };
    if (cues.hasIs) return { start, strategy: "10q-item1-partial-headings" };
  }

  for (const start of itemStarts) {
    if (!isLikelyTocItemMarker(acc, start, normalized)) return { start, strategy: "10q-item1" };
  }
  return { start: itemStarts[0] ?? null, strategy: itemStarts[0] != null ? "10q-item1-fallback" : "none" };
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

function primaryStatementsCeiling(acc: string, section: FilingSectionBounds): number {
  const notes = collectMatches(acc, NOTES_HEADING_PATTERNS, section.start + 800).find(
    (offset) => offset < section.end
  );
  return notes ?? section.end;
}

/** Identify the expected financial-statements section for 10-Q Item 1 or 10-K Item 8 (incl. Part IV exhibits). */
export function locateFinancialStatementsSection(
  ctx: LocatorContext,
  form: string
): { section: FilingSectionBounds; strategy: string; scanCeiling: number } | null {
  const normalized = form.toUpperCase();
  const { start, strategy } = resolveItemStart(ctx.acc, normalized);
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
