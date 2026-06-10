import type { CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import { normalizeSpace } from "./signals";
import type { StatementKind } from "./types";

function tableText($: CheerioAPI, el: Element): string {
  const parts: string[] = [];
  for (const tr of $(el).find("tr").toArray()) {
    for (const cell of $(tr).find("th,td").toArray()) {
      const t = normalizeSpace($(cell).text());
      if (t) parts.push(t);
    }
  }
  return parts.join(" ").slice(0, 8_000).toLowerCase();
}

/** Lightweight primary-face check for 10-Q section proof (no sec-filing-financials import). */
export function tableTextMatchesPrimaryFaceKind(kind: StatementKind, text: string): boolean {
  const t = normalizeSpace(text).toLowerCase().slice(0, 8_000);
  if (!t) return false;

  if (/\bselected\s+financial\s+data\b/.test(t)) return false;
  if (/\btable\s+of\s+contents\b/.test(t)) return false;
  if (/\bsegment\s+information\b/.test(t) && kind === "is") return false;
  if (/\bas\s+a\s+percentage\b/.test(t) && kind === "is") return false;

  if (kind === "is") {
    const hasOci =
      /\bother comprehensive income\b/.test(t) ||
      /\bcomprehensive income\b/.test(t) ||
      /\bcomprehensive loss\b/.test(t);
    const hasRevenue =
      /(?:^|\s)(?:total\s+)?revenues?\b/.test(t) ||
      /\bnet\s+sales\b/.test(t) ||
      /\bnet\s+revenues?\b/.test(t) ||
      /\bcontract\s+revenues?\b/.test(t);
    const hasEarnings =
      /\bnet\s+(?:income|loss)\b/.test(t) ||
      /\bgross\s+profit\b/.test(t) ||
      /\boperating\s+income\b/.test(t) ||
      /\bincome\s+from\s+operations\b/.test(t) ||
      /\bconsolidated\s+net\s+income\b/.test(t);
    const hasExpenseStack =
      /\bcost\s+of\s+(?:revenues?|sales)\b/.test(t) ||
      /\boperating\s+costs?\s+and\s+expenses\b/.test(t) ||
      /\boperating\s+expenses\b/.test(t);
    if (hasOci && !hasRevenue && !hasExpenseStack) return false;
    if (/\bbalance\s+as\s+of\b/.test(t) && /\brepurchases?\s+of\s+common\s+stock\b/.test(t)) return false;
    return hasRevenue && (hasEarnings || hasExpenseStack);
  }

  if (kind === "bs") {
    if (/\bparenthetical\b/.test(t) && !/\btotal\s+assets\b/.test(t)) return false;
    return (
      (/\btotal\s+assets\b/.test(t) && !/\btotal\s+assets\s+held\s+for\s+sale\b/.test(t)) ||
      (/\btotal\s+current\s+assets\b/.test(t) && /\bcash\s+and\s+cash\s+equivalents\b/.test(t))
    );
  }

  return (
    /\boperating\s+activities\b/.test(t) ||
    /\bnet\s+cash\s+(?:provided|used)\b/.test(t) ||
    (/\bnet\s+(?:income|loss)\b/.test(t) && /\bdepreciation\b/.test(t))
  );
}

export function tenQSectionHasFaceTrio(
  $: CheerioAPI,
  tables: Array<{ el: Element; offset: number }>,
  start: number,
  scanEnd: number
): boolean {
  const found: Record<StatementKind, boolean> = { is: false, bs: false, cf: false };
  for (const table of tables) {
    if (table.offset < start || table.offset >= scanEnd) continue;
    const text = tableText($, table.el);
    for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
      if (!found[kind] && tableTextMatchesPrimaryFaceKind(kind, text)) found[kind] = true;
    }
  }
  return found.is && found.bs && found.cf;
}
