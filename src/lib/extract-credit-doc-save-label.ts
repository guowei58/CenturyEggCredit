import { parseMarkdownTablesForExcel } from "@/lib/markdown-tables-to-xlsx";

export type CreditDocTableRowMeta = {
  securityFacility?: string;
  documentType?: string;
  documentTitle?: string;
  filingDate?: string;
};

function normalizeUrlForMatch(url: string): string {
  try {
    const u = new URL(url.trim());
    u.hash = "";
    let s = u.toString().toLowerCase();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim().toLowerCase().replace(/\/$/, "");
  }
}

function normalizeHeader(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isMeaningfulCell(value: string | undefined): value is string {
  if (!value) return false;
  const t = value.trim();
  if (!t || t === "—" || t === "-" || t === "–" || t === "n/a" || t === "N/A") return false;
  return true;
}

function urlsInText(text: string): string[] {
  const urls: string[] = [];
  const src = text.trim();
  if (!src) return urls;

  for (const m of src.matchAll(/\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/gi)) {
    urls.push(m[1]!);
  }
  for (const m of src.matchAll(/https?:\/\/[^\s<>")\]|]+/gi)) {
    urls.push(m[0]!);
  }
  return urls;
}

export function buildCreditDocSaveLabel(meta: CreditDocTableRowMeta): string {
  const parts = [
    meta.documentType,
    meta.documentTitle,
    meta.securityFacility,
    meta.filingDate,
  ].filter(isMeaningfulCell);
  return parts.join(" — ").trim().slice(0, 480);
}

type ColumnIndices = {
  security?: number;
  documentType?: number;
  documentTitle?: number;
  filingDate?: number;
  directLink?: number;
  filingLink?: number;
};

function resolveColumnIndices(headers: string[]): ColumnIndices | null {
  const norm = headers.map(normalizeHeader);
  const find = (...needles: string[]) => {
    for (let i = 0; i < norm.length; i++) {
      const h = norm[i]!;
      if (needles.some((n) => h === n || h.includes(n))) return i;
    }
    return -1;
  };

  const directLink = find("direct document link", "direct link", "direct exhibit link", "exhibit link");
  const filingLink = find("filing link", "parent filing link", "filing page");
  if (directLink < 0 && filingLink < 0) return null;

  const pick = (...needles: string[]) => {
    const i = find(...needles);
    return i >= 0 ? i : undefined;
  };

  return {
    security: pick("security facility", "instrument facility"),
    documentType: pick("document type", "doc type"),
    documentTitle: pick("document title"),
    filingDate: pick("filing date"),
    directLink: directLink >= 0 ? directLink : undefined,
    filingLink: filingLink >= 0 ? filingLink : undefined,
  };
}

function getCell(row: string[], index: number | undefined): string {
  if (index == null || index < 0) return "";
  return (row[index] ?? "").trim();
}

function indexRowFromTable(rows: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  if (rows.length < 2) return map;

  const headers = rows[0] ?? [];
  const cols = resolveColumnIndices(headers);
  if (!cols) return map;

  for (const row of rows.slice(1)) {
    const meta: CreditDocTableRowMeta = {
      securityFacility: getCell(row, cols.security),
      documentType: getCell(row, cols.documentType),
      documentTitle: getCell(row, cols.documentTitle),
      filingDate: getCell(row, cols.filingDate),
    };
    const label = buildCreditDocSaveLabel(meta);
    if (!label) continue;

    const linkCells = [cols.directLink, cols.filingLink]
      .filter((i): i is number => i != null && i >= 0)
      .map((i) => getCell(row, i));

    for (const cell of linkCells) {
      for (const url of urlsInText(cell)) {
        map.set(normalizeUrlForMatch(url), label);
      }
    }
  }

  return map;
}

function stripHtmlTags(raw: string): string {
  return raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseHtmlTableRows(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tableMatch: RegExpExecArray | null;
  while ((tableMatch = tableRe.exec(html)) !== null) {
    const body = tableMatch[1] ?? "";
    const rows: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch: RegExpExecArray | null;
    while ((rowMatch = rowRe.exec(body)) !== null) {
      const rowHtml = rowMatch[1] ?? "";
      const cells: string[] = [];
      const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
      let cellMatch: RegExpExecArray | null;
      while ((cellMatch = cellRe.exec(rowHtml)) !== null) {
        const cellHtml = cellMatch[1] ?? "";
        const withLinks = cellHtml.replace(
          /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
          (_m, href: string, text: string) => {
            const label = stripHtmlTags(text);
            return label ? `[${label}](${href})` : href;
          }
        );
        cells.push(stripHtmlTags(withLinks));
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length > 0) tables.push(rows);
  }
  return tables;
}

/** Build a map of normalized URL -> descriptive save label from credit-doc list tables. */
export function buildCreditDocSaveLabelMap(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const trimmed = content.trim();
  if (!trimmed) return map;

  for (const table of parseMarkdownTablesForExcel(trimmed)) {
    for (const [url, label] of indexRowFromTable(table.rows)) {
      if (!map.has(url)) map.set(url, label);
    }
  }

  for (const rows of parseHtmlTableRows(trimmed)) {
    for (const [url, label] of indexRowFromTable(rows)) {
      if (!map.has(url)) map.set(url, label);
    }
  }

  return map;
}

/** Resolve a descriptive save label for a URL in credit-doc list saved content. */
export function extractCreditDocSaveLabelForUrl(content: string, url: string): string | null {
  const key = normalizeUrlForMatch(url);
  if (!key) return null;
  const label = buildCreditDocSaveLabelMap(content).get(key);
  return label?.trim() ? label : null;
}

export function lookupCreditDocSaveLabel(map: Map<string, string>, url: string): string | undefined {
  const label = map.get(normalizeUrlForMatch(url));
  return label?.trim() ? label : undefined;
}
