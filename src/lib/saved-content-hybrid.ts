/**
 * Server-only: read/write saved tab content in Postgres (per signed-in user).
 */

import { readUserTickerDocument, writeUserTickerDocument } from "@/lib/user-workspace-store";

export async function readSavedContent(
  ticker: string,
  key: string,
  userId?: string | null
): Promise<string | null> {
  if (!userId) return null;
  return readUserTickerDocument(userId, ticker, key);
}

export async function writeSavedContent(
  ticker: string,
  key: string,
  content: string,
  userId?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!userId) return { ok: false, error: "Unauthorized" };
  return writeUserTickerDocument(userId, ticker, key, content);
}
