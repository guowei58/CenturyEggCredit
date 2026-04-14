/**
 * Server-only: scan user's per-ticker cloud workspace for AI Chat (OREO) context.
 * Only `.txt` / `.html` / `.htm` files are included — no PDFs, Excel, JSON IR DBs, etc.
 */

import path from "path";

import { SAVED_TAB_FILENAME_AI_PRIORITY, sanitizeTicker } from "@/lib/saved-ticker-data";
import { workspaceFetchTxtHtmlFilesForAi } from "@/lib/user-ticker-workspace-store";

const MAX_CHARS_PER_FILE_BLOCK = 95_000;

function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[truncated]`;
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
 * `.txt` / `.html` / `.htm` files under the user's cloud workspace (Postgres), excluding
 * basenames already covered by saved-tab documents in `buildUserDbOreoContext`.
 */
export async function buildTickerWorkspaceOreoContext(
  userId: string,
  ticker: string,
  opts?: { charBudget?: number }
): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";

  const files = await workspaceFetchTxtHtmlFilesForAi(userId, sym);
  if (files.length === 0) return "";

  const prioritySet = new Set(SAVED_TAB_FILENAME_AI_PRIORITY.map((f) => f.toLowerCase()));
  const forContent = files.filter((f) => {
    const base = path.posix.basename(f.path.replace(/\\/g, "/"));
    if (prioritySet.has(base.toLowerCase())) return false;
    return true;
  });

  if (forContent.length === 0) return "";

  const charBudget = Math.max(40_000, opts?.charBudget ?? 550_000);
  const budget: Budget = { left: charBudget };
  const chunks: string[] = [];

  const invMax = Math.min(48_000, Math.floor(charBudget * 0.14));
  const fullInv =
    `Ticker ${sym} — ${forContent.length} .txt/.html file(s) in your cloud workspace for ${sym} (path, size_chars)\n` +
    forContent.map((f) => `${f.path}\t${f.text.length}`).join("\n");
  const inv =
    fullInv.length <= invMax
      ? fullInv
      : `${clip(fullInv, invMax)}\n…[inventory list truncated by character budget; ${forContent.length} files total]`;

  appendBlock(chunks, budget, `OREO workspace — file inventory (${sym})`, inv);

  chunks.push(`\n========== OREO workspace — file contents (${sym}) ==========\n`);
  budget.left -= `\n========== OREO workspace — file contents (${sym}) ==========\n`.length;

  for (const f of forContent) {
    if (budget.left < 300) break;
    appendFileSection(chunks, budget, f.path, f.text);
  }

  return chunks.join("").trim();
}
