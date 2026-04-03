/**
 * Server-only: build OREO-style text context from Postgres (tab docs + Saved Documents binaries).
 */

import {
  SAVED_DATA_FILES,
  SAVED_TAB_FILENAME_AI_PRIORITY,
  sanitizeTicker,
} from "@/lib/saved-ticker-data";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import {
  listUserSavedDocumentsBodiesForAi,
  listUserTickerDocuments,
} from "@/lib/user-workspace-store";

const MAX_CHARS_PER_BLOCK = 95_000;

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

/** Map filename from priority list → dataKey */
function dataKeyForFilename(filename: string): string | null {
  const entry = Object.entries(SAVED_DATA_FILES).find(([, f]) => f === filename);
  return entry ? entry[0] : null;
}

/**
 * Text context from Postgres `UserTickerDocument` and `UserSavedDocument` for this user + ticker.
 */
export async function buildUserDbOreoContext(
  userId: string,
  ticker: string,
  opts?: { charBudget?: number }
): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";

  const [rows, savedBodies] = await Promise.all([
    listUserTickerDocuments(userId, sym),
    listUserSavedDocumentsBodiesForAi(userId, sym, 24),
  ]);

  const byKey = new Map(rows.map((r) => [r.dataKey, r.content]));

  const charBudget = Math.max(40_000, opts?.charBudget ?? 550_000);
  const budget: Budget = { left: charBudget };
  const chunks: string[] = [];

  const lines: string[] = [];
  for (const fn of SAVED_TAB_FILENAME_AI_PRIORITY) {
    const key = dataKeyForFilename(fn);
    if (!key) continue;
    const content = byKey.get(key);
    if (content == null || !content.trim()) continue;
    lines.push(`${fn}\t${content.length}`);
  }

  if (lines.length > 0) {
    const inv = `Ticker ${sym} — ${lines.length} saved tab document(s) (user workspace)\n${lines.join("\n")}`;
    appendBlock(chunks, budget, `OREO workspace — document inventory (${sym})`, inv);

    const tabHeader = `\n========== OREO workspace — saved tab contents (${sym}) ==========\n`;
    chunks.push(tabHeader);
    budget.left -= tabHeader.length;

    for (const fn of SAVED_TAB_FILENAME_AI_PRIORITY) {
      if (budget.left < 300) break;
      const key = dataKeyForFilename(fn);
      if (!key) continue;
      const content = byKey.get(key);
      if (content == null || !content.trim()) continue;
      const head = `\n---------- ${fn} ----------\n`;
      const maxBody = Math.max(0, budget.left - head.length - 60);
      if (maxBody < 60) break;
      const clipped = clip(content, Math.min(MAX_CHARS_PER_BLOCK, maxBody));
      const block = head + clipped + "\n";
      chunks.push(block);
      budget.left -= block.length;
    }
  }

  if (savedBodies.length > 0 && budget.left > 400) {
    const invLines = savedBodies.map((s) => `${s.filename}\t${s.body.length}`);
    const invSaved = `Ticker ${sym} — ${savedBodies.length} saved document(s)\n${invLines.join("\n")}`;
    appendBlock(chunks, budget, `OREO workspace — Saved Documents inventory (${sym})`, invSaved);

    const docHeader = `\n========== OREO workspace — Saved Documents text (${sym}) ==========\n`;
    chunks.push(docHeader);
    budget.left -= docHeader.length;

    for (const { filename, body } of savedBodies) {
      if (budget.left < 300) break;
      const text = await extractBytesForAi(filename, body);
      const head = `\n---------- Saved Documents/${filename} ----------\n`;
      const maxBody = Math.max(0, budget.left - head.length - 60);
      if (maxBody < 60) break;
      const clipped = clip(text, Math.min(MAX_CHARS_PER_BLOCK, maxBody));
      const block = head + clipped + "\n";
      chunks.push(block);
      budget.left -= block.length;
    }
  }

  return chunks.join("").trim();
}
