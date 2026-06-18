import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element as DomElement } from "domhandler";

export const NARRATIVE_TABLE_TOTAL_ROW_CLASS = "ixbrl-narrative-total-row";

export function normalizeNarrativeTableRowLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().replace(/[.:]+$/g, "").trim();
}

/** True when the row label starts with "Total" (matches Financials tab subtotal cue). */
export function narrativeTableRowStartsWithTotal(label: string): boolean {
  const normalized = normalizeNarrativeTableRowLabel(label);
  if (!normalized) return false;
  return /^total\b/i.test(normalized);
}

function appendTotalRowClass(existing: string | undefined): string {
  const cls = (existing ?? "").trim();
  if (cls.split(/\s+/).includes(NARRATIVE_TABLE_TOTAL_ROW_CLASS)) return cls;
  return cls ? `${cls} ${NARRATIVE_TABLE_TOTAL_ROW_CLASS}` : NARRATIVE_TABLE_TOTAL_ROW_CLASS;
}

export function applyNarrativeTableTotalRowHighlightCheerio(
  $frag: CheerioAPI,
  root: Cheerio<DomElement>
): void {
  root.find("table tr").each((_, node) => {
    if (node.type !== "tag") return;
    const $tr = $frag(node);
    const parentTag = ($tr.parent().prop("tagName") ?? "").toString().toLowerCase();
    if (parentTag === "thead") return;

    const label = normalizeNarrativeTableRowLabel($tr.find("td, th").first().text());
    if (!narrativeTableRowStartsWithTotal(label)) return;

    $tr.attr("class", appendTotalRowClass($tr.attr("class")));
  });
}

/** Client-side pass for cached HTML that predates server highlighting. */
export function highlightNarrativeTableTotalRowsHtml(html: string): string {
  if (!html?.trim()) return html;
  if (typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(`<div id="ixbrl-narrative-root">${html}</div>`, "text/html");
  const root = doc.getElementById("ixbrl-narrative-root");
  if (!root) return html;

  for (const tr of root.querySelectorAll("table tr")) {
    if (tr.parentElement?.tagName.toLowerCase() === "thead") continue;
    const firstCell = tr.querySelector("td, th");
    const label = normalizeNarrativeTableRowLabel(firstCell?.textContent ?? "");
    if (!narrativeTableRowStartsWithTotal(label)) continue;
    tr.classList.add(NARRATIVE_TABLE_TOTAL_ROW_CLASS);
  }

  return root.innerHTML;
}
