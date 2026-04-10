import * as XLSX from "xlsx";
import { prisma } from "@/lib/prisma";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { parseSecXbrlSavedWorkbook } from "@/lib/xbrl-saved-history/parseWorkbook";

/** Leave headroom for user wrapper + model context vs tab-prompt-complete limits when inlined. */
const MAX_PACK_CHARS = 300_000;

type DocRow = { filename: string; body: Buffer; savedAtIso: string };

function workbookToTextBlocks(buf: Buffer, filename: string): { text: string; sheetCount: number } {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true, raw: false });
  const parts: string[] = [];
  let included = 0;
  for (const sheetName of wb.SheetNames) {
    if (sheetName.toLowerCase().includes("xbrl raw")) continue;
    const sh = wb.Sheets[sheetName];
    if (!sh) continue;
    included++;
    const csv = XLSX.utils.sheet_to_csv(sh, { FS: ",", blankrows: false });
    parts.push(`<<<SHEET ${sheetName}>>>\n${csv}\n`);
  }
  return { text: parts.join("\n"), sheetCount: included };
}

function sortKeyForDoc(d: DocRow): { filingDate: string; savedAt: string } {
  const parsed = parseSecXbrlSavedWorkbook(Buffer.from(d.body), d.filename);
  return {
    filingDate: parsed?.meta.filingDate ?? "",
    savedAt: d.savedAtIso,
  };
}

export type IngestPackResult =
  | {
      ok: true;
      text: string;
      fileCount: number;
      sheetCount: number;
      truncated: boolean;
      filenames: string[];
    }
  | { ok: false; error: string };

/**
 * Loads every saved SEC-XBRL Excel workbook for the ticker and serializes all sheets as CSV-like text
 * for LLM ingestion (newest filing dates first).
 */
export async function buildSavedXbrlTextPack(userId: string, ticker: string): Promise<IngestPackResult> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const docs = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    select: { filename: true, body: true, savedAtIso: true },
    orderBy: { savedAtIso: "desc" },
  });

  const xbrlDocs: DocRow[] = docs
    .filter(
      (d) =>
        d.filename.toLowerCase().includes("sec-xbrl-financials") && d.filename.toLowerCase().endsWith(".xlsx")
    )
    .map((d) => ({ filename: d.filename, body: Buffer.from(d.body), savedAtIso: d.savedAtIso }));

  if (!xbrlDocs.length) {
    return {
      ok: false,
      error:
        "No saved SEC-XBRL Excel workbooks for this ticker. Save exports from SEC XBRL Financials (filename contains SEC-XBRL-financials).",
    };
  }

  xbrlDocs.sort((a, b) => {
    const ka = sortKeyForDoc(a);
    const kb = sortKeyForDoc(b);
    if (ka.filingDate !== kb.filingDate) return kb.filingDate.localeCompare(ka.filingDate);
    return kb.savedAt.localeCompare(ka.savedAt);
  });

  const chunks: string[] = [];
  let total = 0;
  let truncated = false;
  let sheetCount = 0;
  const filenames: string[] = [];

  const header = `Ticker: ${sym}\nWorkbooks below are CSV exports of each Excel sheet (duplicate "(XBRL raw)" sheets are omitted). Primary statement grids use SEC-style display (instance + negated label roles) in USD millions.\n\n`;

  total += header.length;
  chunks.push(header);

  for (const d of xbrlDocs) {
    filenames.push(d.filename);
    const meta = parseSecXbrlSavedWorkbook(Buffer.from(d.body), d.filename);
    const metaLine = `FilingDate(sort key): ${meta?.meta.filingDate ?? "(unknown)"} · Form: ${meta?.meta.form ?? "?"} · Accession: ${meta?.meta.accession ?? "?"} · SavedAt: ${d.savedAtIso}\n`;
    const { text: body, sheetCount: sc } = workbookToTextBlocks(d.body, d.filename);
    sheetCount += sc;
    const block = `\n<<<FILE ${d.filename}>>>\n${metaLine}${body}\n`;

    if (total + block.length <= MAX_PACK_CHARS) {
      chunks.push(block);
      total += block.length;
      continue;
    }

    const room = MAX_PACK_CHARS - total - 200;
    if (room > 2_000) {
      chunks.push(block.slice(0, room));
      chunks.push("\n...(truncated: pack size cap reached; remaining files/sheets omitted)\n");
      truncated = true;
    } else {
      chunks.push("\n...(truncated: pack size cap reached before this file)\n");
      truncated = true;
    }
    total = MAX_PACK_CHARS;
    break;
  }

  return {
    ok: true,
    text: chunks.join(""),
    fileCount: xbrlDocs.length,
    sheetCount,
    truncated,
    filenames,
  };
}
