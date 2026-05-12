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

const DEBT_CORE_HINTS =
  /\b(debt|total\s+debt|long[\s-]*term\s+debt|short[\s-]*term\s+debt|borrowings|notes\s+payable|credit\s+facilit(?:y|ies)|revolving\s+credit|term\s+loan|debentures?|senior\s+notes|convertible\s+notes|debt\s+disclosure|supplier\s+and\s+vendor\s+financing|fair\s+value.*long[\s-]*term\s+debt)\b/i;
const DEBT_FILENAME_HINTS =
  /\b(debt|borrow|credit|termloan|notespayable|debenture|convertible|supplier|vendor)\b/i;
const DEBT_GENERIC_NEGATIVE_HINTS =
  /\b(statement|cover\s+page|financial\s+assets?\s*&\s*liabilities|financial\s+instruments?|financing\s+receivables|derivative|leases?\b|discontinued\s+operations|preparation\s+of\s+interim\s+financial\s+statements|additional\s+financial\s+information)\b/i;

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
    if (o.MyReports !== undefined && typeof o.MyReports === "object") {
      const inner = (o.MyReports as Record<string, unknown>).Report;
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
  const scoreReport = (rep: FilingSummaryReportRef): number => {
    const short = String(rep.shortName ?? "").trim();
    const long = String(rep.longName ?? "").trim();
    const menu = String(rep.menuCategory ?? "").trim();
    const file = String(rep.htmlFile ?? "").trim();
    const blob = [short, long, menu, file].filter(Boolean).join(" | ");
    if (!blob) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (DEBT_CORE_HINTS.test(blob)) score += 80;
    if (file && DEBT_FILENAME_HINTS.test(file)) score += 18;
    if (/^\s*(debt|borrowings?|total\s+debt|long[\s-]*term\s+debt)\b/i.test(short)) score += 28;
    if (/\((?:notes|tables)\)/i.test(short) || /\bdisclosure\b/i.test(long)) score += 8;
    if (/\bdetail/i.test(short) || /\bdetail/i.test(long)) score -= 6;
    if (DEBT_GENERIC_NEGATIVE_HINTS.test(blob) && !DEBT_CORE_HINTS.test(blob)) score -= 50;
    if (/\bfair\s+value\b/i.test(blob) && !/\blong[\s-]*term\s+debt\b/i.test(blob)) score -= 12;
    return score;
  };

  return reports
    .map((rep) => ({ rep, score: scoreReport(rep) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ rep }) => rep);
}
