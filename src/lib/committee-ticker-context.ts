/**
 * Server-only: bundle saved OREO workspace text for AI Chat context (Postgres only).
 */

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { buildTickerWorkspaceOreoContext } from "@/lib/ticker-workspace-for-ai";
import { buildUserDbOreoContext } from "@/lib/user-oreo-context";

const DEFAULT_CONTEXT_CHAR_BUDGET = 550_000;

function resolveContextCharBudget(): number {
  const raw = process.env.COMMITTEE_OREO_CONTEXT_CHAR_BUDGET?.trim();
  if (!raw) return DEFAULT_CONTEXT_CHAR_BUDGET;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 50_000) return DEFAULT_CONTEXT_CHAR_BUDGET;
  return Math.min(n, 900_000);
}

/**
 * Returns markdown-ish plain text for the system prompt, or empty string if nothing saved.
 */
export async function buildCommitteeOreoContext(ticker: string, userId?: string | null): Promise<string> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return "";
  const budget = resolveContextCharBudget();
  if (!userId) return "";

  const dbPart = await buildUserDbOreoContext(userId, sym, { charBudget: budget });
  const room = Math.max(0, budget - dbPart.length - 4_000);
  const wsPart = room > 12_000 ? await buildTickerWorkspaceOreoContext(userId, sym, { charBudget: room }) : "";

  return [dbPart, wsPart].filter(Boolean).join("\n\n");
}
