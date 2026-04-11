/**
 * Server-only: per-user watchlist, AI chat blob, and ticker tab documents (Postgres).
 */

import { prisma } from "@/lib/prisma";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";

export async function readUserTickerDocument(
  userId: string,
  ticker: string,
  key: string
): Promise<string | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym || !(key in SAVED_DATA_FILES)) return null;
  const row = await prisma.userTickerDocument.findUnique({
    where: { userId_ticker_dataKey: { userId, ticker: sym, dataKey: key } },
  });
  return row ? row.content : null;
}

export async function writeUserTickerDocument(
  userId: string,
  ticker: string,
  key: string,
  content: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  if (!(key in SAVED_DATA_FILES)) return { ok: false, error: "Invalid save key" };
  try {
    await prisma.userTickerDocument.upsert({
      where: { userId_ticker_dataKey: { userId, ticker: sym, dataKey: key } },
      create: { userId, ticker: sym, dataKey: key, content },
      update: { content },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Write failed" };
  }
}

export async function listUserTickerDocuments(userId: string, ticker: string) {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  return prisma.userTickerDocument.findMany({
    where: { userId, ticker: sym },
  });
}

/** True if this user has anything on the server for this ticker that credit-memo ingest can materialize. */
export async function hasUserTickerServerIngestSources(userId: string, ticker: string): Promise<boolean> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return false;
  const [wsFiles, savedDocs, tabWithText] = await Promise.all([
    prisma.userTickerWorkspaceFile.count({ where: { userId, ticker: sym } }),
    prisma.userSavedDocument.count({ where: { userId, ticker: sym } }),
    prisma.userTickerDocument.findFirst({
      where: { userId, ticker: sym, NOT: { content: "" } },
      select: { content: true },
    }),
  ]);
  if (wsFiles > 0 || savedDocs > 0) return true;
  return !!(tabWithText && tabWithText.content.trim().length > 0);
}

export async function getWatchlistTickers(userId: string): Promise<string[]> {
  const rows = await prisma.userWatchlistEntry.findMany({
    where: { userId },
    orderBy: { sortOrder: "asc" },
  });
  return rows.map((r) => r.ticker);
}

export async function setWatchlistTickers(userId: string, tickers: string[]): Promise<void> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const t of tickers) {
    const sym = sanitizeTicker(t);
    if (!sym || seen.has(sym)) continue;
    seen.add(sym);
    normalized.push(sym);
  }
  await prisma.$transaction([
    prisma.userWatchlistEntry.deleteMany({ where: { userId } }),
    prisma.userWatchlistEntry.createMany({
      data: normalized.map((ticker, sortOrder) => ({ userId, ticker, sortOrder })),
    }),
  ]);
}

const MAX_AI_CHAT_PAYLOAD_CHARS = 2_000_000;

export async function getAiChatPayload(userId: string, ticker: string): Promise<string | null> {
  const row = await prisma.userAiChatState.findUnique({
    where: { userId_ticker: { userId, ticker } },
  });
  return row?.payload ?? null;
}

export async function setAiChatPayload(
  userId: string,
  ticker: string,
  payload: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (payload.length > MAX_AI_CHAT_PAYLOAD_CHARS) {
    return { ok: false, error: "Chat data too large to save." };
  }
  try {
    await prisma.userAiChatState.upsert({
      where: { userId_ticker: { userId, ticker } },
      create: { userId, ticker, payload },
      update: { payload },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

const MAX_SAVED_DOCS_PER_TICKER = 500;
const MAX_SAVED_DOC_BYTES = 35 * 1024 * 1024;

export type UserSavedDocumentListRow = {
  id: string;
  ticker: string;
  filename: string;
  title: string;
  originalUrl: string;
  contentType: string | null;
  savedAtIso: string;
  bytes: number;
  convertedToPdf: boolean;
};

async function trimUserSavedDocuments(userId: string, ticker: string): Promise<void> {
  const count = await prisma.userSavedDocument.count({ where: { userId, ticker } });
  if (count < MAX_SAVED_DOCS_PER_TICKER) return;
  const toRemove = count - MAX_SAVED_DOCS_PER_TICKER + 1;
  const oldest = await prisma.userSavedDocument.findMany({
    where: { userId, ticker },
    orderBy: { createdAt: "asc" },
    take: toRemove,
    select: { id: true },
  });
  if (oldest.length) {
    await prisma.userSavedDocument.deleteMany({
      where: { id: { in: oldest.map((o) => o.id) } },
    });
  }
}

export async function listUserSavedDocumentRows(
  userId: string,
  ticker: string
): Promise<UserSavedDocumentListRow[] | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const rows = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    orderBy: { savedAtIso: "desc" },
    take: MAX_SAVED_DOCS_PER_TICKER,
    select: {
      id: true,
      ticker: true,
      filename: true,
      title: true,
      originalUrl: true,
      contentType: true,
      savedAtIso: true,
      bytes: true,
      convertedToPdf: true,
    },
  });
  return rows;
}

/** Recent saved docs with binary body for AI context (bounded count). */
export async function listUserSavedDocumentsBodiesForAi(
  userId: string,
  ticker: string,
  take: number
): Promise<Array<{ filename: string; body: Buffer }>> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const n = Math.max(1, Math.min(take, 40));
  const rows = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    orderBy: { savedAtIso: "desc" },
    take: n,
    select: { filename: true, body: true },
  });
  return rows.map((r) => ({ filename: r.filename, body: Buffer.from(r.body) }));
}

/** All saved documents for this user+ticker (credit memo / deck ingest materialization). */
export async function listAllUserSavedDocumentsBodiesForIngest(
  userId: string,
  ticker: string
): Promise<Array<{ filename: string; body: Buffer }>> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const rows = await prisma.userSavedDocument.findMany({
    where: { userId, ticker: sym },
    orderBy: { savedAtIso: "desc" },
    take: MAX_SAVED_DOCS_PER_TICKER,
    select: { filename: true, body: true },
  });
  return rows.map((r) => ({ filename: r.filename, body: Buffer.from(r.body) }));
}

export async function getUserSavedDocumentBody(
  userId: string,
  ticker: string,
  filename: string
): Promise<Buffer | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) return null;
  const row = await prisma.userSavedDocument.findUnique({
    where: { userId_ticker_filename: { userId, ticker: sym, filename: fn } },
    select: { body: true },
  });
  if (!row?.body) return null;
  return Buffer.from(row.body);
}

export async function createUserSavedDocument(
  userId: string,
  ticker: string,
  data: {
    filename: string;
    title: string;
    originalUrl: string;
    contentType: string | null;
    body: Buffer;
    savedAtIso: string;
    convertedToPdf: boolean;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  if (data.body.length > MAX_SAVED_DOC_BYTES) {
    return { ok: false, error: "Document too large to store." };
  }
  const fn = data.filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }
  try {
    await trimUserSavedDocuments(userId, sym);
    const row = await prisma.userSavedDocument.create({
      data: {
        userId,
        ticker: sym,
        filename: fn,
        title: data.title,
        originalUrl: data.originalUrl,
        contentType: data.contentType,
        body: new Uint8Array(data.body),
        savedAtIso: data.savedAtIso,
        bytes: data.body.length,
        convertedToPdf: data.convertedToPdf,
      },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

/** Create or replace by (user, ticker, filename). Does not run trim when the row already exists. */
export async function upsertUserSavedDocument(
  userId: string,
  ticker: string,
  data: {
    filename: string;
    title: string;
    originalUrl: string;
    contentType: string | null;
    body: Buffer;
    savedAtIso: string;
    convertedToPdf: boolean;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  if (data.body.length > MAX_SAVED_DOC_BYTES) {
    return { ok: false, error: "Document too large to store." };
  }
  const fn = data.filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) {
    return { ok: false, error: "Invalid filename" };
  }
  try {
    const existing = await prisma.userSavedDocument.findUnique({
      where: { userId_ticker_filename: { userId, ticker: sym, filename: fn } },
      select: { id: true },
    });
    if (!existing) {
      await trimUserSavedDocuments(userId, sym);
    }
    const row = await prisma.userSavedDocument.upsert({
      where: { userId_ticker_filename: { userId, ticker: sym, filename: fn } },
      create: {
        userId,
        ticker: sym,
        filename: fn,
        title: data.title,
        originalUrl: data.originalUrl,
        contentType: data.contentType,
        body: new Uint8Array(data.body),
        savedAtIso: data.savedAtIso,
        bytes: data.body.length,
        convertedToPdf: data.convertedToPdf,
      },
      update: {
        title: data.title,
        originalUrl: data.originalUrl,
        contentType: data.contentType,
        body: new Uint8Array(data.body),
        savedAtIso: data.savedAtIso,
        bytes: data.body.length,
        convertedToPdf: data.convertedToPdf,
      },
    });
    return { ok: true, id: row.id };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function deleteUserSavedDocument(
  userId: string,
  ticker: string,
  filename: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  const fn = filename.trim();
  if (!fn || fn.includes("/") || fn.includes("\\") || fn.includes("..")) {
    return { ok: false, error: "Invalid file" };
  }
  try {
    await prisma.userSavedDocument.deleteMany({
      where: { userId, ticker: sym, filename: fn },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed" };
  }
}
