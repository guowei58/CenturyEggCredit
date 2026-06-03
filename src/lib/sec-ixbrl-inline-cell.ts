/**
 * Inline XBRL (`ix:nonFraction`) extraction from HTML table cells.
 * Shared by HTML statement parsing and TEST face enrichment.
 */

import * as cheerio from "cheerio";
import type { ChildNode, Element as DomElement } from "domhandler";

export type InlineIxCellMeta = {
  visibleText: string;
  xbrlConcept: string | null;
  contextRef: string | null;
  unitRef: string | null;
  decimals: string | null;
  scale: number | null;
  format: string | null;
  sign: string | null;
  rawValue: number | null;
};

function parseSpan(value: string | undefined): number {
  const n = Number.parseInt(value ?? "1", 10);
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export function isIxNonFractionTag(name: string): boolean {
  const n = name.toLowerCase();
  return n === "ix:nonfraction" || n.endsWith(":nonfraction");
}

/** True when primary filing HTML embeds inline XBRL amount tags (`ix:nonFraction`). */
export function primaryHtmlHasInlineIxTags(html: string): boolean {
  return /<ix:nonfraction\b/i.test(html ?? "");
}

export function parseIxNonFractionRawUsd($: cheerio.CheerioAPI, el: DomElement): number | null {
  const $el = $(el);
  const raw = $el.text().replace(/,/g, "").trim();
  const num = parseFloat(raw);
  if (!Number.isFinite(num)) return null;
  let scale = parseInt(String($el.attr("scale") ?? "0"), 10);
  if (!Number.isFinite(scale)) scale = 0;
  let v = num * 10 ** scale;
  const signAttr = $el.attr("sign");
  if (signAttr === "-" || signAttr === "-1") v = -Math.abs(v);
  return v;
}

function findIxNonFractionInSubtree($: cheerio.CheerioAPI, root: DomElement): DomElement | null {
  let ixEl: DomElement | null = null;
  const visit = (node: ChildNode) => {
    if (ixEl) return;
    if (node.type !== "tag") return;
    const tag = node as DomElement;
    if (isIxNonFractionTag(tag.name ?? "")) {
      ixEl = tag;
      return;
    }
    for (const c of tag.children ?? []) visit(c);
  };
  visit(root);
  return ixEl;
}

function normalizeAmountKey(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\$/g, "")
    .replace(/,/g, "")
    .replace(/[()]/g, "")
    .toLowerCase();
}

export function domCellForMatrixColumn($: cheerio.CheerioAPI, tr: DomElement, matrixCol: number): DomElement | null {
  let col = 0;
  for (const cell of $(tr)
    .children("th,td")
    .toArray()
    .filter((n): n is DomElement => n.type === "tag")) {
    const $cell = $(cell);
    const colspan = parseSpan($cell.attr("colspan"));
    if (matrixCol >= col && matrixCol < col + colspan) return cell;
    col += colspan;
  }
  return null;
}

/** Adjacent cells when amount is split across `$`, `(`, number, `)`. */
function domCellsForAmountAtMatrixColumn($: cheerio.CheerioAPI, tr: DomElement, matrixCol: number): DomElement[] {
  const primary = domCellForMatrixColumn($, tr, matrixCol);
  const out: DomElement[] = [];
  if (primary) out.push(primary);
  if (matrixCol > 0) {
    const left = domCellForMatrixColumn($, tr, matrixCol - 1);
    if (left && !out.includes(left)) out.unshift(left);
  }
  const right = domCellForMatrixColumn($, tr, matrixCol + 1);
  if (right && !out.includes(right)) out.push(right);
  return out;
}

export function extractInlineIxFromTableCell(
  $: cheerio.CheerioAPI,
  cell: DomElement,
  visibleText: string
): InlineIxCellMeta {
  const ixEl = findIxNonFractionInSubtree($, cell);
  if (!ixEl) {
    return {
      visibleText,
      xbrlConcept: null,
      contextRef: null,
      unitRef: null,
      decimals: null,
      scale: null,
      format: null,
      sign: null,
      rawValue: null,
    };
  }
  const $ix = $(ixEl);
  const name = ($ix.attr("name") ?? "").trim() || null;
  const scaleRaw = $ix.attr("scale");
  const scale = scaleRaw != null && scaleRaw !== "" ? parseInt(scaleRaw, 10) : null;
  const rawValue = parseIxNonFractionRawUsd($, ixEl);
  return {
    visibleText,
    xbrlConcept: name,
    contextRef: ($ix.attr("contextref") ?? $ix.attr("contextRef") ?? "").trim() || null,
    unitRef: ($ix.attr("unitref") ?? $ix.attr("unitRef") ?? "").trim() || null,
    decimals: ($ix.attr("decimals") ?? "").trim() || null,
    scale: Number.isFinite(scale) ? scale : null,
    format: ($ix.attr("format") ?? "").trim() || null,
    sign: ($ix.attr("sign") ?? "").trim() || null,
    rawValue,
  };
}

export function extractInlineIxForMatrixAmountCell(
  $: cheerio.CheerioAPI,
  tr: DomElement,
  matrixCol: number,
  visibleText: string
): InlineIxCellMeta {
  const cells = domCellsForAmountAtMatrixColumn($, tr, matrixCol);
  for (const cell of cells) {
    const meta = extractInlineIxFromTableCell($, cell, visibleText);
    if (meta.xbrlConcept) return meta;
  }
  return extractInlineIxFromTableCell($, cells[0] ?? tr, visibleText);
}

/** Match ix facts in the row by visible printed amount (handles colspan / split `$` cells). */
export function findInlineIxInRowByVisibleText(
  $: cheerio.CheerioAPI,
  tr: DomElement,
  visibleText: string
): InlineIxCellMeta | null {
  const want = normalizeAmountKey(visibleText);
  if (!want || want === "—" || want === "-") return null;

  const ixNodes = $(tr)
    .find("*")
    .toArray()
    .filter((n) => n.type === "tag" && isIxNonFractionTag((n as DomElement).name ?? ""));

  for (const ixEl of ixNodes) {
    const tag = ixEl as DomElement;
    const printed = normalizeAmountKey($(tag).text());
    if (!printed) continue;
    if (printed === want || printed.replace(/^-/, "") === want.replace(/^-/, "")) {
      return extractInlineIxFromTableCell($, tag, visibleText);
    }
  }
  return null;
}

/** Last resort: ordered ix tags on the row mapped to period columns left-to-right. */
export function listInlineIxOnRow($: cheerio.CheerioAPI, tr: DomElement): InlineIxCellMeta[] {
  const ixNodes = $(tr)
    .find("*")
    .toArray()
    .filter((n) => n.type === "tag" && isIxNonFractionTag((n as DomElement).name ?? ""));

  return ixNodes.map((ixEl) => {
    const tag = ixEl as DomElement;
    const visibleText = $(tag).text().replace(/\s+/g, " ").trim();
    return extractInlineIxFromTableCell($, tag, visibleText);
  });
}
