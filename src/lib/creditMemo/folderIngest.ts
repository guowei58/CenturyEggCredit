import type { Dirent } from "fs";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";

import { extractTickerFileForAi } from "@/lib/ticker-file-text-extract";
import { loadCreditMemoConfig } from "./config";
import { classifySourceFilename } from "./fileClassifier";
import type { CreditMemoProject, ExtractedTableRecord, SourceChunkRecord, SourceFileRecord } from "./types";
import type { SourceCategory } from "./types";

const CHUNK_CHARS = 12_000;
const CHUNK_OVERLAP = 400;

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 22);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(r + path.sep);
}

type FileEntry = { rel: string; abs: string; size: number };

async function walkFiles(rootDir: string, cfgMaxBytes: number, maxFiles: number): Promise<FileEntry[]> {
  const out: FileEntry[] = [];

  async function walk(currentAbs: string, currentRel: string): Promise<void> {
    if (out.length >= maxFiles) return;
    let entries: Dirent[];
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const ent of sorted) {
      if (out.length >= maxFiles) return;
      if (ent.name === "." || ent.name === "..") continue;
      if (ent.name.startsWith(".")) continue;
      const rel = currentRel ? path.join(currentRel, ent.name) : ent.name;
      const abs = path.join(currentAbs, ent.name);
      if (!isPathInsideRoot(rootDir, abs)) continue;
      if (ent.isDirectory()) {
        await walk(abs, rel);
      } else if (ent.isFile()) {
        let st;
        try {
          st = await fs.stat(abs);
        } catch {
          continue;
        }
        if (st.size > cfgMaxBytes) {
          out.push({ rel: rel.replace(/\\/g, "/"), abs, size: st.size });
          continue;
        }
        out.push({ rel: rel.replace(/\\/g, "/"), abs, size: st.size });
      }
    }
  }

  await walk(rootDir, "");
  out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" }));
  return out;
}

async function fileFingerprint(absPath: string, size: number): Promise<string | null> {
  // Fast-ish content fingerprint used only to detect duplicates across different paths.
  // - For smaller files: hash full contents.
  // - For larger files: hash (size + head + tail) to avoid ingest-time stalls.
  const FULL_HASH_MAX = 20 * 1024 * 1024;
  const EDGE_BYTES = 1024 * 1024;

  try {
    if (size <= FULL_HASH_MAX) {
      const buf = await fs.readFile(absPath);
      return createHash("sha256").update(buf).digest("hex");
    }

    const fh = await fs.open(absPath, "r");
    try {
      const headLen = Math.min(EDGE_BYTES, size);
      const head = Buffer.alloc(headLen);
      await fh.read(head, 0, headLen, 0);

      const tailLen = Math.min(EDGE_BYTES, Math.max(0, size - headLen));
      const tail = Buffer.alloc(tailLen);
      if (tailLen > 0) {
        const tailPos = Math.max(0, size - tailLen);
        await fh.read(tail, 0, tailLen, tailPos);
      }

      const h = createHash("sha256");
      h.update(String(size));
      h.update(head);
      if (tailLen > 0) h.update(tail);
      return h.digest("hex");
    } finally {
      await fh.close();
    }
  } catch {
    return null;
  }
}

function chunkText(text: string, relPath: string): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= CHUNK_CHARS) return [t];
  const chunks: string[] = [];
  let i = 0;
  while (i < t.length && chunks.length < 200) {
    const end = Math.min(i + CHUNK_CHARS, t.length);
    let slice = t.slice(i, end);
    if (end < t.length) {
      const lastBreak = slice.lastIndexOf("\n\n");
      if (lastBreak > CHUNK_CHARS * 0.55) slice = slice.slice(0, lastBreak);
    }
    chunks.push(slice);
    const step = Math.max(1, slice.length - CHUNK_OVERLAP);
    i += step;
  }
  return chunks;
}

function detectSectionLabel(text: string): string | null {
  const lines = text.split("\n").slice(0, 12);
  for (const line of lines) {
    const l = line.trim();
    if (/^(#+\s+|table\s+\d+|exhibit\s*\d+)/i.test(l)) return l.slice(0, 120);
    if (l.length >= 8 && l.length <= 100 && /^[A-Z]/.test(l) && !/\d{4}-\d{2}/.test(l)) {
      if (l === l.toUpperCase()) return l;
    }
  }
  return null;
}

export async function ingestTickerFolder(params: {
  projectId: string;
  ticker: string;
  folderAbs: string;
}): Promise<{ project: CreditMemoProject; warnings: string[] }> {
  const cfg = loadCreditMemoConfig();
  const warnings: string[] = [];

  const filesRaw = await walkFiles(params.folderAbs, cfg.maxIngestFileBytes, cfg.maxFilesPerIngest);
  if (filesRaw.length >= cfg.maxFilesPerIngest) {
    warnings.push(`File cap reached (${cfg.maxFilesPerIngest}); deeper paths may be omitted.`);
  }

  // Dedupe by content fingerprint so copies in multiple places don't get ingested twice.
  const seen = new Map<string, string>(); // fingerprint -> first rel path
  const files: FileEntry[] = [];
  const dupRel: string[] = [];
  for (const f of filesRaw) {
    const fp = f.size > cfg.maxIngestFileBytes ? null : await fileFingerprint(f.abs, f.size);
    if (!fp) {
      files.push(f);
      continue;
    }
    const first = seen.get(fp);
    if (first) {
      dupRel.push(f.rel);
      continue;
    }
    seen.set(fp, f.rel);
    files.push(f);
  }
  if (dupRel.length > 0) {
    warnings.push(
      `Skipped ${dupRel.length} duplicate file(s) (same content found in multiple paths): ${dupRel.slice(0, 12).join(", ")}${
        dupRel.length > 12 ? " …" : ""
      }`
    );
  }

  const sources: SourceFileRecord[] = [];
  const chunks: SourceChunkRecord[] = [];
  const tables: ExtractedTableRecord[] = [];

  for (const f of files) {
    const ext = path.extname(f.rel).toLowerCase();
    const category: SourceCategory = classifySourceFilename(f.rel);

    if (f.size > cfg.maxIngestFileBytes) {
      const sid = stableId(["src", params.projectId, f.rel]);
      sources.push({
        id: sid,
        relPath: f.rel,
        absPath: f.abs,
        size: f.size,
        ext,
        category,
        modifiedAt: null,
        parseStatus: "skipped",
        charExtracted: 0,
        parseNote: `Skipped: file exceeds CREDIT_MEMO_MAX_FILE_BYTES (${cfg.maxIngestFileBytes})`,
      });
      continue;
    }

    let mtime: string | null = null;
    try {
      const st = await fs.stat(f.abs);
      mtime = new Date(st.mtimeMs).toISOString();
    } catch {
      /* */
    }

    const text = await extractTickerFileForAi(f.abs, f.rel, f.size);
    const sid = stableId(["src", params.projectId, f.rel]);

    const failed = text.startsWith("[") && /failed|not parsed|too large|No extractable/i.test(text);
    const partial = /truncated|\[PDF|\[Spreadsheet|placeholder/i.test(text);

    const source: SourceFileRecord = {
      id: sid,
      relPath: f.rel,
      absPath: f.abs,
      size: f.size,
      ext,
      category,
      modifiedAt: mtime,
      parseStatus: failed ? "failed" : partial ? "partial" : "ok",
      charExtracted: text.length,
    };
    sources.push(source);

    if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm" || ext === ".csv") {
      const tid = stableId(["tbl", sid, "0"]);
      tables.push({
        id: tid,
        sourceFileId: sid,
        title: path.basename(f.rel),
        sheetName: null,
        previewText: text.slice(0, 24_000),
      });
    }

    const parts = chunkText(text, f.rel);
    parts.forEach((p, idx) => {
      chunks.push({
        id: stableId(["chk", sid, String(idx)]),
        sourceFileId: sid,
        chunkIndex: idx,
        text: p,
        sectionLabel: idx === 0 ? detectSectionLabel(p) : null,
      });
    });
  }

  const project: CreditMemoProject = {
    id: params.projectId,
    ticker: params.ticker,
    resolvedFolderPath: params.folderAbs,
    folderResolutionJson: null,
    status: "ingested",
    createdAt: nowIso(),
    updatedAt: nowIso(),
    sources,
    chunks,
    tables,
    ingestWarnings: warnings,
  };

  return { project, warnings };
}

export function createProjectId(
  ticker: string,
  folderAbs: string,
  opts?: { userWorkspaceUserId?: string }
): string {
  if (opts?.userWorkspaceUserId) {
    return stableId(["cmproj", ticker.toUpperCase(), "userws", opts.userWorkspaceUserId]);
  }
  return stableId(["cmproj", ticker.toUpperCase(), path.resolve(folderAbs)]);
}
