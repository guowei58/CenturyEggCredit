/**
 * Server-only: bundle saved OREO workspace text for AI Chat context (Postgres only).
 */

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { buildTickerWorkspaceOreoContext } from "@/lib/ticker-workspace-for-ai";
import { buildUserDbOreoContext } from "@/lib/user-oreo-context";

const DEFAULT_CONTEXT_CHAR_BUDGET = 550_000;

/** DeepSeek chat models enforce ~131k input tokens; OREO text must share that budget with system + full thread. */
const DEFAULT_DEEPSEEK_COMMITTEE_OREO_CHAR_BUDGET = 200_000;

function resolveContextCharBudget(): number {
  const raw = process.env.COMMITTEE_OREO_CONTEXT_CHAR_BUDGET?.trim();
  if (!raw) return DEFAULT_CONTEXT_CHAR_BUDGET;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 50_000) return DEFAULT_CONTEXT_CHAR_BUDGET;
  return Math.min(n, 900_000);
}

export function resolveDeepSeekCommitteeOreoCharBudget(): number {
  const raw = process.env.COMMITTEE_OREO_CONTEXT_DEEPSEEK_CHAR_BUDGET?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 40_000) return Math.min(n, 500_000);
  }
  return DEFAULT_DEEPSEEK_COMMITTEE_OREO_CHAR_BUDGET;
}

/**
 * Returns markdown-ish plain text for the system prompt, or empty string if nothing saved.
 * @param opts.maxCharBudget — cap total OREO chars (e.g. DeepSeek vs larger Claude/OpenAI windows).
 */
export async function buildCommitteeOreoContext(
  ticker: string,
  userId?: string | null,
  opts?: { maxCharBudget?: number }
): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";
  const base = resolveContextCharBudget();
  const budget =
    opts?.maxCharBudget != null ? Math.min(base, Math.max(40_000, opts.maxCharBudget)) : base;
  if (!userId) return "";

  const dbPart = await buildUserDbOreoContext(userId, sym, { charBudget: budget });
  const room = Math.max(0, budget - dbPart.length - 4_000);
  const wsPart = room > 12_000 ? await buildTickerWorkspaceOreoContext(userId, sym, { charBudget: room }) : "";

  return [dbPart, wsPart].filter(Boolean).join("\n\n");
}
