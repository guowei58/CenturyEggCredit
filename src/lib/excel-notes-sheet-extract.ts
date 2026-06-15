import * as XLSX from "xlsx";

const MAX_NOTES_CHARS = 20_000;

function normalizeSheetName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Pick the workbook tab most likely to hold analyst summary / notes commentary. */
export function findNotesLikeSheetName(sheetNames: string[]): string | null {
  const scored = sheetNames
    .map((name) => {
      const norm = normalizeSheetName(name);
      let score = 0;
      if (norm === "notes") score = 100;
      else if (norm === "summary notes" || norm === "summary note") score = 95;
      else if (norm === "notes / assumptions" || norm === "notes assumptions") score = 90;
      else if (norm.startsWith("notes /") || norm.startsWith("notes-")) score = 85;
      else if (norm.includes("summary") && norm.includes("note")) score = 80;
      else if (norm.endsWith(" notes") || norm.startsWith("notes ")) score = 70;
      return { name, score };
    })
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored[0]?.name ?? null;
}

function sheetToPlainText(sheet: XLSX.WorkSheet): string {
  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });

  const lines: string[] = [];
  for (const row of rows) {
    if (!Array.isArray(row)) continue;
    const cells = row
      .map((cell) => String(cell ?? "").trim())
      .filter(Boolean);
    if (cells.length > 0) lines.push(cells.join("\t"));
  }
  return lines.join("\n").trim();
}

/** Extract text from the Notes / Summary notes worksheet in a capital-structure or org-chart workbook. */
export function extractNotesSheetFromXlsxBuffer(buf: Buffer): string | null {
  if (!buf.length) return null;
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  } catch {
    return null;
  }

  const sheetName = findNotesLikeSheetName(wb.SheetNames);
  if (!sheetName) return null;

  const sheet = wb.Sheets[sheetName];
  if (!sheet) return null;

  const text = sheetToPlainText(sheet);
  if (!text) return null;
  return text.length > MAX_NOTES_CHARS ? `${text.slice(0, MAX_NOTES_CHARS)}\n\n[truncated]` : text;
}
