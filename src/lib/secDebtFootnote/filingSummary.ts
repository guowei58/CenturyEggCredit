/**
 * EDGAR accession FilingSummary.xml → debt-related rendered reports (often R*.htm).
 */

import { XMLParser } from "fast-xml-parser";

export type FilingSummaryReportRef = {
  shortName?: string;
  longName?: string;
  menuCategory?: string;
  htmlFile?: string;
};

const DEBT_FILENAME_HINTS = /debt|borrow|credit|financ|convertible|lease\s+obligation|notes?\s+payable/i;

const DEBT_MENU_HINTS =
  /\b(debt|long[\s-]*term\s+debt|borrowings|notes\s+payable|credit\s+facilities|financing\s+arrangements|convertible\s+notes|finance\s+lease\s+obligations|debt\s+and\s+finance\s+lease)/i;

export function filingSummaryXmlUrl(cikPadded10: string, accessionDashed: string): string {
  const cikNum = String(parseInt(cikPadded10.replace(/^0+/, "") || "0", 10));
  const accFlat = accessionDashed.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accFlat}/FilingSummary.xml`;
}

export function filingSummaryMemberUrl(cikPadded10: string, accessionDashed: string, fileName: string): string {
  const cikNum = String(parseInt(cikPadded10.replace(/^0+/, "") || "0", 10));
  const accFlat = accessionDashed.replace(/-/g, "");
  const safe = fileName.replace(/^\.+\//, "").replace(/\\/g, "/");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accFlat}/${safe}`;
}

function asArray<T>(x: T | T[] | undefined): T[] {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function pickReportsRoot(parsed: Record<string, unknown>): unknown {
  const tryNode = (node: unknown): unknown => {
    if (!node || typeof node !== "object") return null;
    const o = node as Record<string, unknown>;
    if (o.Report !== undefined) return o.Report;
    if (o.Reports !== undefined && typeof o.Reports === "object") {
      const inner = (o.Reports as Record<string, unknown>).Report;
      if (inner !== undefined) return inner;
    }
    return null;
  };

  let hit = tryNode(parsed);
  if (hit) return hit;

  hit = tryNode(parsed.FilingSummary);
  if (hit) return hit;

  const root = parsed as { Filings?: Record<string, unknown> };
  if (root.Filings && typeof root.Filings === "object") {
    const f = root.Filings;
    hit = tryNode(f);
    if (hit) return hit;
  }

  return null;
}

export function parseFilingSummaryReports(xml: string): FilingSummaryReportRef[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "",
    isArray: () => false,
    trimValues: true,
  });
  let parsed: Record<string, unknown>;
  try {
    parsed = parser.parse(xml) as Record<string, unknown>;
  } catch {
    return [];
  }
  const raw = pickReportsRoot(parsed);
  const rows = asArray(raw as Record<string, unknown>);
  const out: FilingSummaryReportRef[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, string | undefined>;
    const shortName = r.ShortName ?? r.shortName;
    const longName = r.LongName ?? r.longName ?? r.MenuCategory ?? r.menuCategory;
    const menuCategory = r.MenuCategory ?? r.menuCategory;
    const htmlFile =
      r.HtmlFile ??
      r.htmlFile ??
      r.HtmlFileName ??
      r.Instance ??
      r.ReportFileName ??
      r.File ??
      undefined;
    out.push({
      shortName: typeof shortName === "string" ? shortName : undefined,
      longName: typeof longName === "string" ? longName : undefined,
      menuCategory: typeof menuCategory === "string" ? menuCategory : undefined,
      htmlFile: typeof htmlFile === "string" ? htmlFile : undefined,
    });
  }
  return out;
}

export function filterDebtRelatedFilingSummaryReports(reports: FilingSummaryReportRef[]): FilingSummaryReportRef[] {
  return reports.filter((rep) => {
    const blob = [rep.shortName, rep.longName, rep.menuCategory, rep.htmlFile].filter(Boolean).join(" | ");
    if (!blob.trim()) return false;
    if (DEBT_MENU_HINTS.test(blob)) return true;
    if (rep.htmlFile && DEBT_FILENAME_HINTS.test(rep.htmlFile)) return true;
    return false;
  });
}
