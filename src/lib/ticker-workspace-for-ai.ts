/**
 * Server-only: materialize user's per-ticker workspace from Postgres to a temp dir, then scan
 * for AI Chat context (same extraction pipeline as former on-disk saved-tickers).
 */

import fs from "fs/promises";
import path from "path";
import {
  isHeavyCovenantRootFile,
  SAVED_TAB_FILENAME_AI_PRIORITY,
  sanitizeTicker,
} from "@/lib/saved-ticker-data";
import {
  materializeUserWorkspaceToTempDir,
  rmTempWorkspaceDir,
  workspaceFileCount,
} from "@/lib/user-ticker-workspace-store";
import { extractTickerFileForAi } from "@/lib/ticker-file-text-extract";

const MAX_CHARS_PER_FILE_BLOCK = 95_000;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[truncated]`;
}

function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(r + path.sep);
}

type FileEntry = { rel: string; abs: string; size: number };

async function listAllFiles(rootDir: string): Promise<FileEntry[]> {
  const out: FileEntry[] = [];

  async function walk(currentAbs: string, currentRel: string): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(currentAbs, { withFileTypes: true });
    } catch {
      return;
    }
    const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    for (const ent of sorted) {
      if (ent.name === "." || ent.name === "..") continue;
      if (ent.name.startsWith(".")) continue;
      const rel = currentRel ? path.posix.join(currentRel.replace(/\\/g, "/"), ent.name) : ent.name;
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
        out.push({ rel, abs, size: st.size });
      }
    }
  }

  await walk(rootDir, "");
  out.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" }));
  return out;
}

function orderFilesForContentIngestion(files: FileEntry[]): FileEntry[] {
  const root: FileEntry[] = [];
  const nested: FileEntry[] = [];
  for (const f of files) {
    if (f.rel.includes("/")) nested.push(f);
    else root.push(f);
  }
  const cmp = (a: FileEntry, b: FileEntry) =>
    a.rel.localeCompare(b.rel, undefined, { sensitivity: "base" });
  root.sort(cmp);
  nested.sort(cmp);
  return [...root, ...nested];
}

type Budget = { left: number };

function appendBlock(out: string[], budget: Budget, title: string, body: string): void {
  const trimmed = body.trim();
  if (!trimmed || budget.left < 120) return;
  const head = `\n========== ${title} ==========\n`;
  const maxBody = Math.max(0, budget.left - head.length - 80);
  if (maxBody < 80) return;
  const slice =
    trimmed.length > maxBody ? `${trimmed.slice(0, maxBody)}\n\n…[truncated for AI Chat context budget]` : trimmed;
  const block = head + slice;
  out.push(block);
  budget.left -= block.length;
}

function appendFileSection(out: string[], budget: Budget, rel: string, content: string): void {
  if (budget.left < 200) return;
  const head = `\n---------- ${rel} ----------\n`;
  const maxBody = Math.max(0, budget.left - head.length - 60);
  if (maxBody < 60) return;
  const clipped = clip(content, Math.min(MAX_CHARS_PER_FILE_BLOCK, maxBody));
  const block = head + clipped + "\n";
  out.push(block);
  budget.left -= block.length;
}

/**
 * Binary / deep-folder workspace files (IR DB, Excel uploads, memo library, etc.).
 */
export async function buildTickerWorkspaceOreoContext(
  userId: string,
  ticker: string,
  opts?: { charBudget?: number }
): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";
  if ((await workspaceFileCount(userId, sym)) === 0) return "";

  const tmp = await materializeUserWorkspaceToTempDir(userId, sym);
  try {
    const charBudget = Math.max(40_000, opts?.charBudget ?? 550_000);
    const budget: Budget = { left: charBudget };
    const chunks: string[] = [];

    const files = await listAllFiles(tmp);
    if (files.length === 0) return "";

    const invMax = Math.min(48_000, Math.floor(charBudget * 0.14));
    const fullInv =
      `Ticker ${sym} — ${files.length} file(s) in your cloud workspace for ${sym} (relative path tab size_bytes)\n` +
      files.map((f) => `${f.rel}\t${f.size}`).join("\n");
    const inv =
      fullInv.length <= invMax
        ? fullInv
        : `${clip(fullInv, invMax)}\n…[inventory list truncated by character budget; ${files.length} files total]`;

    appendBlock(chunks, budget, `OREO workspace — file inventory (${sym})`, inv);

    chunks.push(`\n========== OREO workspace — file contents (${sym}) ==========\n`);
    budget.left -= `\n========== OREO workspace — file contents (${sym}) ==========\n`.length;

    const prioritySet = new Set(SAVED_TAB_FILENAME_AI_PRIORITY.map((f) => f.toLowerCase()));
    const forContent = orderFilesForContentIngestion(files).filter((f) => {
      const base = path.posix.basename(f.rel);
      if (prioritySet.has(base.toLowerCase())) return false;
      if (!f.rel.includes("/") && isHeavyCovenantRootFile(base)) return false;
      return true;
    });

    for (const f of forContent) {
      if (budget.left < 300) break;
      const body = await extractTickerFileForAi(f.abs, f.rel, f.size);
      appendFileSection(chunks, budget, f.rel, body);
    }

    return chunks.join("").trim();
  } finally {
    await rmTempWorkspaceDir(tmp);
  }
}
