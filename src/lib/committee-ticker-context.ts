/**
 * Server-only: bundle saved OREO workspace text for AI Chat context (Postgres only).
 */

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { buildTickerWorkspaceOreoContext } from "@/lib/ticker-workspace-for-ai";
import { buildUserDbOreoContext } from "@/lib/user-oreo-context";
import type { AiProvider } from "@/lib/ai-provider";

const DEFAULT_CONTEXT_CHAR_BUDGET = 550_000;

/**
 * Approximate safe char budget per provider so OREO context + conversation history + system
 * prompt stays well within the model's context window.
 *
 * Real-world tokenization for financial/credit text averages ~3 chars/token (not the
 * commonly-quoted ~4 for English prose), so budgets are conservative.
 *
 * deepseek-chat  : 131K context → target ≤ 100K tokens input → ~280K chars.
 *                  Subtract system prompt (~2K) + reply (4K) + conversation history headroom
 *                  → 200K char budget keeps first-turn safely under 100K tokens.
 * openai (gpt-4o): 128K context → similar to DeepSeek.
 * claude (200K)  / gemini (1M+): can afford the larger default.
 */
const PROVIDER_CHAR_BUDGET: Record<string, number> = {
  deepseek: 200_000,
  openai: 250_000,
  claude: DEFAULT_CONTEXT_CHAR_BUDGET,
  gemini: DEFAULT_CONTEXT_CHAR_BUDGET,
};

function resolveContextCharBudget(provider?: AiProvider | null): number {
  const raw = process.env.COMMITTEE_OREO_CONTEXT_CHAR_BUDGET?.trim();
  if (raw) {
    const n = parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 50_000) return Math.min(n, 900_000);
  }
  if (provider && provider in PROVIDER_CHAR_BUDGET) {
    return PROVIDER_CHAR_BUDGET[provider];
  }
  return DEFAULT_CONTEXT_CHAR_BUDGET;
}

/**
 * Returns markdown-ish plain text for the system prompt, or empty string if nothing saved.
 */
export async function buildCommitteeOreoContext(
  ticker: string,
  userId?: string | null,
  provider?: AiProvider | null,
): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";
  const budget = resolveContextCharBudget(provider);
  if (!userId) return "";

  const dbPart = await buildUserDbOreoContext(userId, sym, { charBudget: budget });
  const room = Math.max(0, budget - dbPart.length - 4_000);
  const wsPart = room > 12_000 ? await buildTickerWorkspaceOreoContext(userId, sym, { charBudget: room }) : "";

  return [dbPart, wsPart].filter(Boolean).join("\n\n");
}
