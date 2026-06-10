import type { ChildNode, Element } from "domhandler";
import type * as cheerio from "cheerio";
import { isIxNonFractionTag } from "@/lib/sec-ixbrl-inline-cell";
import type { FilingSectionBounds, LocatorContext, LocatedTable, StatementBlock } from "./types";
import {
  NEGATIVE_CONTEXT_PATTERNS,
  POSITIVE_HEADINGS,
  POSITIVE_ROW_ANCHORS,
  countPatternHits,
  normalizeSpace,
} from "./signals";
import type { StatementKind } from "./types";
import { extractHeadingBeforeOffset } from "./section";

function countIxTags($: cheerio.CheerioAPI, el: Element): number {
  let count = 0;
  const visit = (node: ChildNode) => {
    if (node.type !== "tag") return;
    const tag = node as Element;
    if (isIxNonFractionTag(tag.name ?? "")) count += 1;
    for (const child of tag.children ?? []) visit(child);
  };
  visit(el);
  return count;
}

function quickTableStats($: cheerio.CheerioAPI, el: Element): {
  valueColumnCount: number;
  dataRowCount: number;
  periodHeaders: string[];
  rowLabels: string[];
} {
  const rows = $(el).find("tr").toArray();
  const matrix: string[][] = rows.map((tr) =>
    $(tr)
      .find("th,td")
      .toArray()
      .map((cell) => normalizeSpace($(cell).text()))
  );
  let dataStart = -1;
  for (let i = 0; i < Math.min(matrix.length, 20); i += 1) {
    const row = matrix[i] ?? [];
    const numeric = row.filter((cell) => /^\(?\d[\d,.\s]*\)?$/.test(cell.replace(/\$/g, "").trim())).length;
    if (numeric >= 1) {
      dataStart = i;
      break;
    }
  }
  if (dataStart < 0) {
    for (let i = 0; i < Math.min(matrix.length, 20); i += 1) {
      const row = matrix[i] ?? [];
      const numeric = row.filter((cell) => /\d/.test(cell) && cell.replace(/[^\d]/g, "").length >= 2).length;
      if (numeric >= 2) {
        dataStart = i;
        break;
      }
    }
  }
  const headerRows = dataStart > 0 ? matrix.slice(0, dataStart) : matrix.slice(0, 2);
  const periodHeaders = headerRows.flat().filter((c) => c && c.length > 3);
  const valueColumnCount =
    dataStart >= 0
      ? (matrix[dataStart] ?? []).filter((cell) => /^\(?\d[\d,.\s]*\)?$/.test(cell.replace(/\$/g, ""))).length
      : 0;
  const rowLabels: string[] = [];
  if (dataStart >= 0) {
    for (let i = dataStart; i < matrix.length; i += 1) {
      const label = normalizeSpace((matrix[i] ?? [])[0] ?? "");
      if (label && !/^\(?\d/.test(label)) rowLabels.push(label);
    }
  }
  return { valueColumnCount, dataRowCount: rowLabels.length, periodHeaders, rowLabels };
}

function extractUnitsText(headingText: string, tableText: string): string {
  const blob = `${headingText} ${tableText.slice(0, 800)}`;
  const m = blob.match(
    /\((?:in\s+|dollars?\s+in\s+|\$\s*in\s+)?(?:thousands|millions|billions)(?:,\s*except[^)]*)?\)/i
  );
  return m ? normalizeSpace(m[0]) : "";
}

function inferKindFromText(text: string): StatementKind | null {
  const scores = (["is", "bs", "cf"] as StatementKind[]).map((kind) => ({
    kind,
    hits: POSITIVE_HEADINGS[kind].filter((re) => {
      re.lastIndex = 0;
      return re.test(text);
    }).length,
  }));
  const best = scores.sort((a, b) => b.hits - a.hits)[0];
  return best && best.hits > 0 ? best.kind : null;
}

function hasMajorHeadingBetween(acc: string, from: number, to: number): boolean {
  const slice = acc.slice(from, to);
  if (NEGATIVE_CONTEXT_PATTERNS.some((re) => {
    re.lastIndex = 0;
    return re.test(slice);
  })) {
    return true;
  }
  const betweenHeading = extractHeadingBeforeOffset(acc, to, Math.min(2_000, to - from));
  const betweenKind = inferKindFromText(betweenHeading);
  const beforeKind = inferKindFromText(extractHeadingBeforeOffset(acc, from, 900));
  if (betweenKind && beforeKind && betweenKind !== beforeKind) return true;
  return false;
}

function inferTableKindHint(
  $: cheerio.CheerioAPI,
  acc: string,
  table: LocatedTable
): StatementKind | null {
  const heading = extractHeadingBeforeOffset(acc, table.offset, 1_600);
  const fromHeading = inferKindFromText(heading);
  if (fromHeading) return fromHeading;
  const text = normalizeSpace($(table.el).text()).slice(0, 4_000);
  const scores = (["is", "bs", "cf"] as StatementKind[]).map((kind) => ({
    kind,
    hits: POSITIVE_ROW_ANCHORS[kind].filter((re) => re.test(text)).length,
  }));
  const best = scores.sort((a, b) => b.hits - a.hits)[0];
  return best && best.hits >= 2 ? best.kind : null;
}

function tablesLookStitchable(
  $: cheerio.CheerioAPI,
  acc: string,
  prev: LocatedTable,
  next: LocatedTable,
  prevStats: ReturnType<typeof quickTableStats>,
  nextStats: ReturnType<typeof quickTableStats>
): boolean {
  if (next.offset - prev.offset > 8_000) return false;
  if (hasMajorHeadingBetween(acc, prev.offset, next.offset)) return false;
  const prevKind = inferTableKindHint($, acc, prev);
  const nextKind = inferTableKindHint($, acc, next);
  if (prevKind && nextKind && prevKind !== nextKind) return false;
  if (prevStats.valueColumnCount > 0 && nextStats.valueColumnCount > 0) {
    if (Math.abs(prevStats.valueColumnCount - nextStats.valueColumnCount) > 1) return false;
  }
  const nextText = normalizeSpace($(next.el).text()).slice(0, 2_000).toLowerCase();
  const continuationCue =
    nextStats.rowLabels.length > 0 &&
    !nextStats.periodHeaders.some((h) => /\b(?:year|months?)\s+ended\b/i.test(h)) &&
    (nextText.includes("total") || nextStats.rowLabels[0]?.length > 0);
  const sharedUnits = prevStats.periodHeaders.length > 0 || nextStats.periodHeaders.length <= 2;
  return continuationCue || sharedUnits;
}

function finalizeBlock(
  $: cheerio.CheerioAPI,
  acc: string,
  tables: LocatedTable[],
  blockIndex: number
): StatementBlock {
  const startOffset = tables[0]!.offset;
  const endOffset = tables[tables.length - 1]!.offset;
  const headingText = extractHeadingBeforeOffset(acc, startOffset);
  const combinedText = tables.map((t) => normalizeSpace($(t.el).text())).join(" ");
  const unitsText = extractUnitsText(headingText, combinedText);
  let ixTagCount = 0;
  let valueColumnCount = 0;
  let dataRowCount = 0;
  const periodHeaders: string[] = [];
  const rowLabels: string[] = [];
  for (const t of tables) {
    const stats = quickTableStats($, t.el);
    ixTagCount += countIxTags($, t.el);
    valueColumnCount = Math.max(valueColumnCount, stats.valueColumnCount);
    dataRowCount += stats.dataRowCount;
    periodHeaders.push(...stats.periodHeaders);
    rowLabels.push(...stats.rowLabels);
  }
  return {
    id: `block-${blockIndex}`,
    tables,
    startOffset,
    endOffset,
    headingText,
    unitsText,
    periodHeaders: [...new Set(periodHeaders)].slice(0, 8),
    rowLabels: rowLabels.slice(0, 40),
    combinedText: combinedText.slice(0, 12_000),
    ixTagCount,
    valueColumnCount,
    dataRowCount,
  };
}

/** Build stitched statement blocks from ordered tables inside the target section. */
export function buildStatementBlocks(
  ctx: LocatorContext,
  section: FilingSectionBounds,
  scanCeiling: number
): StatementBlock[] {
  const localTables = ctx.tables
    .map((table, domIndex) => ({ ...table, domIndex }))
    .filter((table) => table.offset >= section.start && table.offset < scanCeiling);

  const blocks: StatementBlock[] = [];
  let i = 0;
  let blockIndex = 0;

  while (i < localTables.length) {
    const current = localTables[i]!;
    const stats = quickTableStats(ctx.$, current.el);
    const tableText = normalizeSpace(ctx.$(current.el).text());
    const trCount = ctx.$(current.el).find("tr").length;
    const numericCells = (tableText.match(/-?\(?\d[\d,.\s]{1,}\)?/g) ?? []).length;
    const ixTagCount = countIxTags(ctx.$, current.el);
    const headingText = extractHeadingBeforeOffset(ctx.acc, current.offset, 1_600);
    const hasStatementHeading = (["is", "bs", "cf"] as StatementKind[]).some((kind) =>
      countPatternHits(headingText, POSITIVE_HEADINGS[kind]) > 0
    );
    const isTiny =
      stats.dataRowCount < 2 &&
      stats.valueColumnCount < 1 &&
      trCount < 5 &&
      numericCells < 10 &&
      tableText.length < 400;
    if (isTiny && ixTagCount < 5 && !hasStatementHeading) {
      i += 1;
      continue;
    }

    const group: LocatedTable[] = [current];
    let j = i + 1;
    while (j < localTables.length) {
      const prev = group[group.length - 1]!;
      const next = localTables[j]!;
      const prevStats = quickTableStats(ctx.$, prev.el);
      const nextStats = quickTableStats(ctx.$, next.el);
      if (!tablesLookStitchable(ctx.$, ctx.acc, prev, next, prevStats, nextStats)) break;
      group.push(next);
      j += 1;
    }

    blocks.push(finalizeBlock(ctx.$, ctx.acc, group, blockIndex));
    blockIndex += 1;
    i = j;
  }

  return blocks;
}
