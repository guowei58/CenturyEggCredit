/**
 * Server-only: best-effort text extraction from ticker-folder files for AI Chat context.
 * Covers common office formats, PDF, spreadsheets, UTF-8/Latin-1 text sniffing, and ZIP sniffing
 * for mis-saved files. Truly opaque binaries (images, video, legacy .ppt) get a short placeholder.
 */

import fs from "fs/promises";
import path from "path";
import JSZip from "jszip";
import mammoth from "mammoth";
import * as XLSX from "xlsx";

import { TEXT_LIKE_EXTENSIONS } from "./text-like-extensions";

export const MAX_TEXT_BYTES = 2 * 1024 * 1024;
export const MAX_PDF_BYTES = 12 * 1024 * 1024;
/** Whole-file read cap for ZIP-based office and similar */
export const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;
export const MAX_SPREADSHEET_BYTES = 15 * 1024 * 1024;
export const MAX_PDF_PAGES = 75;
/** Hard cap on characters returned from a single file before workspace-level clipping */
const MAX_CHARS_PER_EXTRACT = 450_000;

const PDF_EXT = new Set([".pdf"]);
const SPREADSHEET_EXT = new Set([".xlsx", ".xls", ".xlsm", ".xlsb", ".ods"]);
const DOCX_EXT = new Set([".docx", ".docm", ".dotx"]);
const PPTX_EXT = new Set([".pptx", ".pptm", ".potx", ".ppsx", ".potm"]);
/** OpenDocument text / presentation (not .ods — handled via xlsx) */
const ODF_XML_EXT = new Set([".odt", ".odp", ".odg", ".ott", ".otp"]);

const IMAGE_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".tif",
  ".tiff",
  ".ico",
  ".svg",
  ".heic",
  ".raw",
]);

const VIDEO_AUDIO_EXT = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".avi",
  ".mkv",
  ".mp3",
  ".wav",
  ".m4a",
  ".flac",
  ".aac",
]);

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[truncated — single-file extract limit]`;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([\da-fA-F]+);/g, (full, h) => {
      const cp = parseInt(h, 16);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
      } catch {
        return full;
      }
    })
    .replace(/&#(\d+);/g, (full, n) => {
      const cp = Number(n);
      try {
        return Number.isFinite(cp) ? String.fromCodePoint(cp) : full;
      } catch {
        return full;
      }
    });
}

function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 0x03 || buf[2] === 0x05 || buf[2] === 0x07);
}

type ZipOfficeKind = "docx" | "pptx" | "xlsx" | "odf";

function detectZipOfficeKind(zip: JSZip): ZipOfficeKind | null {
  const keys = new Set(Object.keys(zip.files).map((k) => k.replace(/\\/g, "/")));
  if (keys.has("word/document.xml")) return "docx";
  if (Array.from(keys).some((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))) return "pptx";
  if (keys.has("xl/workbook.xml")) return "xlsx";
  if (keys.has("content.xml")) return "odf";
  return null;
}

async function extractPptxFromBuffer(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const slideEntries: { raw: string; norm: string }[] = [];
  for (const raw of Object.keys(zip.files)) {
    const entry = zip.files[raw];
    if (!entry || entry.dir) continue;
    const norm = raw.replace(/\\/g, "/");
    if (!/^ppt\/(slides|notesSlides)\/(slide|notesSlide)\d+\.xml$/i.test(norm)) continue;
    slideEntries.push({ raw, norm });
  }
  slideEntries.sort((a, b) => {
    const na = parseInt(a.norm.match(/\d+/)?.[0] ?? "0", 10);
    const nb = parseInt(b.norm.match(/\d+/)?.[0] ?? "0", 10);
    return na - nb || a.norm.localeCompare(b.norm);
  });

  const chunks: string[] = [];
  for (const { raw, norm } of slideEntries) {
    const f = zip.file(raw);
    if (!f) continue;
    const xml = await f.async("string");
    const runs = Array.from(xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/gi))
      .map((m) => decodeXmlEntities(m[1].trim()))
      .filter(Boolean);
    if (runs.length) chunks.push(`--- ${norm} ---\n${runs.join(" ")}`);
  }
  const out = chunks.join("\n\n").trim();
  return out || "[PowerPoint — no text runs found in XML.]";
}

async function extractDocxFromBuffer(buf: Buffer): Promise<string> {
  const { value } = await mammoth.extractRawText({ buffer: buf });
  const t = (value || "").trim();
  return t || "[Word — no extractable text.]";
}

async function extractOdfContentXml(buf: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buf);
  const content = zip.file("content.xml");
  if (!content) return "[OpenDocument — missing content.xml.]";
  const xml = await content.async("string");
  const stripped = xml
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stripped || "[OpenDocument — empty after text strip.]";
}

async function extractSpreadsheet(buf: Buffer): Promise<string> {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: true });
  const parts: string[] = [];
  for (const name of wb.SheetNames.slice(0, 12)) {
    const sheet = wb.Sheets[name];
    if (!sheet) continue;
    let csv = XLSX.utils.sheet_to_csv(sheet, { FS: "\t" });
    csv = clip(csv, 36_000);
    parts.push(`--- Sheet: ${name} ---\n${csv}`);
  }
  return parts.join("\n\n").trim() || "[Spreadsheet — empty.]";
}

function tryDecodeAsText(buf: Buffer): string | null {
  const max = Math.min(buf.length, MAX_TEXT_BYTES);
  const slice = buf.subarray(0, max);
  for (const enc of ["utf8", "latin1"] as const) {
    const s = slice.toString(enc);
    if (s.length === 0) continue;
    let ok = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127)) ok++;
    }
    const ratio = ok / s.length;
    if (ratio >= 0.94 && !s.includes("\u0000")) {
      const full = buf.length <= max ? buf.toString(enc) : slice.toString(enc);
      return full.trim().length ? full : null;
    }
  }
  return null;
}

async function extractPdf(buf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    const tr = await parser.getText({ first: MAX_PDF_PAGES });
    const text = (tr.text || "").trim();
    if (!text) return "[PDF — no extractable text (may be scan-only).]";
    return text;
  } finally {
    await parser.destroy().catch(() => undefined);
  }
}

async function extractFromZipByKind(buf: Buffer, kind: ZipOfficeKind): Promise<string> {
  switch (kind) {
    case "docx":
      return extractDocxFromBuffer(buf);
    case "pptx":
      return extractPptxFromBuffer(buf);
    case "xlsx":
      return extractSpreadsheet(buf);
    case "odf":
      return extractOdfContentXml(buf);
    default:
      return "[ZIP — unrecognized Office layout.]";
  }
}

/**
 * Credit-memo / Work Product folder ingest: PDFs are normalized to plain text only (binary PDF is never chunked).
 * Same text pipeline as other callers; kept explicit so ingest can depend on a single “PDF → UTF-8 text” step.
 */
export async function extractPdfAsPlainTextForIngest(abs: string, _rel: string, size: number): Promise<string> {
  if (size > MAX_PDF_BYTES) {
    return `[PDF too large (${size} bytes; cap ${MAX_PDF_BYTES}). Export pages or raise cap.]`;
  }
  try {
    const buf = await fs.readFile(abs);
    const clipOut = (s: string) => clip(s, MAX_CHARS_PER_EXTRACT);
    return clipOut(await extractPdf(buf));
  } catch (e) {
    return `[Read/extract failed: ${e instanceof Error ? e.message : "error"}]`;
  }
}

/**
 * Same as `extractTickerFileForAi` but for an in-memory file (e.g. Postgres-stored Saved Documents).
 */
export async function extractBytesForAi(rel: string, buf: Buffer): Promise<string> {
  const ext = path.extname(rel).toLowerCase();
  const size = buf.length;

  if (IMAGE_EXT.has(ext)) {
    return `[Image — visual content not sent to the model; ${size} bytes. Export text or describe in chat.]`;
  }
  if (VIDEO_AUDIO_EXT.has(ext)) {
    return `[Audio/video — not transcribed; ${size} bytes. Paste a transcript or summary if needed.]`;
  }
  if (ext === ".ppt" || ext === ".doc" || ext === ".xls") {
    return `[Legacy Microsoft ${ext} (binary) — not parsed. Save as .pptx/.docx/.xlsx or export PDF/text.]`;
  }

  const clipOut = (s: string) => clip(s, MAX_CHARS_PER_EXTRACT);

  try {
    if (PDF_EXT.has(ext)) {
      if (size > MAX_PDF_BYTES) {
        return `[PDF too large (${size} bytes; cap ${MAX_PDF_BYTES}). Export pages or raise cap.]`;
      }
      return clipOut(await extractPdf(buf));
    }

    if (SPREADSHEET_EXT.has(ext)) {
      if (size > MAX_SPREADSHEET_BYTES) {
        return `[Spreadsheet too large (${size} bytes; cap ${MAX_SPREADSHEET_BYTES}).]`;
      }
      return clipOut(await extractSpreadsheet(buf));
    }

    if (DOCX_EXT.has(ext)) {
      if (size > MAX_ARCHIVE_BYTES) return `[Word file too large (${size} bytes).]`;
      return clipOut(await extractDocxFromBuffer(buf));
    }

    if (PPTX_EXT.has(ext)) {
      if (size > MAX_ARCHIVE_BYTES) return `[PowerPoint file too large (${size} bytes).]`;
      return clipOut(await extractPptxFromBuffer(buf));
    }

    if (ODF_XML_EXT.has(ext)) {
      if (size > MAX_ARCHIVE_BYTES) return `[OpenDocument file too large (${size} bytes).]`;
      return clipOut(await extractOdfContentXml(buf));
    }

    if (TEXT_LIKE_EXTENSIONS.has(ext)) {
      if (size > MAX_TEXT_BYTES) return `[Text file too large (${size} bytes; cap ${MAX_TEXT_BYTES}).]`;
      return clipOut(buf.toString("utf8"));
    }

    if (size > MAX_ARCHIVE_BYTES) {
      const head = buf.subarray(0, Math.min(65536, buf.length));
      if (looksLikeZip(head)) {
        return `[Large ZIP-based file (${size} bytes) exceeds ${MAX_ARCHIVE_BYTES} byte read cap. Split or export to text.]`;
      }
      const partial = tryDecodeAsText(head);
      if (partial && partial.length > 200) {
        return clipOut(`${partial}\n\n…[only first ${head.length} bytes read; file exceeds cap.]`);
      }
      return `[File too large for full scan (${size} bytes; cap ${MAX_ARCHIVE_BYTES}). Extension: ${ext || "(none)"}.]`;
    }

    if (looksLikeZip(buf)) {
      try {
        const zip = await JSZip.loadAsync(buf);
        const kind = detectZipOfficeKind(zip);
        if (kind) return clipOut(await extractFromZipByKind(buf, kind));
      } catch {
        /* fall through */
      }
    }

    const asText = tryDecodeAsText(buf);
    if (asText) return clipOut(asText);

    return `[No extractable text (${ext || "no extension"}, ${size} bytes). Export to PDF/DOCX/TXT or paste content.]`;
  } catch (e) {
    return `[Read/extract failed: ${e instanceof Error ? e.message : "error"}]`;
  }
}

/**
 * Best-effort plain text for AI context. Images / media / legacy binary Office get a placeholder.
 */
export async function extractTickerFileForAi(abs: string, rel: string, size: number): Promise<string> {
  const ext = path.extname(rel).toLowerCase();

  if (IMAGE_EXT.has(ext)) {
    return `[Image — visual content not sent to the model; ${size} bytes. Export text or describe in chat.]`;
  }
  if (VIDEO_AUDIO_EXT.has(ext)) {
    return `[Audio/video — not transcribed; ${size} bytes. Paste a transcript or summary if needed.]`;
  }
  if (ext === ".ppt" || ext === ".doc" || ext === ".xls") {
    return `[Legacy Microsoft ${ext} (binary) — not parsed. Save as .pptx/.docx/.xlsx or export PDF/text.]`;
  }

  try {
    const buf = await fs.readFile(abs);
    return await extractBytesForAi(rel, buf);
  } catch (e) {
    return `[Read/extract failed: ${e instanceof Error ? e.message : "error"}]`;
  }
}
