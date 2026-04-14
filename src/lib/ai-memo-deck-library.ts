/**
 * Per-user ticker library of generated credit memos (markdown) and decks (.pptx) in Postgres
 * via UserTickerWorkspaceFile under ai-memo-deck-library/.
 */

import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  workspaceDeleteFile,
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

const LIB_PREFIX = "ai-memo-deck-library";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MemoDeckLibraryMemoEntry = {
  id: string;
  kind: "memo";
  title: string;
  createdAt: string;
  variant?: string | null;
  provider?: string | null;
  /** API model id used for generation (e.g. claude-sonnet-4-20250514). */
  llmModel?: string | null;
  memoFile: string;
};

export type MemoDeckLibraryDeckEntry = {
  id: string;
  kind: "deck";
  title: string;
  createdAt: string;
  provider?: string | null;
  llmModel?: string | null;
  deckFile: string;
};

export type MemoDeckLibraryEntry = MemoDeckLibraryMemoEntry | MemoDeckLibraryDeckEntry;

type IndexJson = { entries: MemoDeckLibraryEntry[] };

function indexPath(): string {
  return `${LIB_PREFIX}/index.json`;
}

export async function readLibraryIndex(userId: string, ticker: string): Promise<MemoDeckLibraryEntry[]> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];
  const raw = await workspaceReadUtf8(userId, sym, indexPath());
  if (!raw) return [];
  try {
    const j = JSON.parse(raw) as IndexJson;
    return Array.isArray(j.entries) ? j.entries : [];
  } catch {
    return [];
  }
}

async function writeLibraryIndex(
  userId: string,
  ticker: string,
  entries: MemoDeckLibraryEntry[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  const r = await workspaceWriteUtf8(userId, sym, indexPath(), JSON.stringify({ entries }, null, 2));
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function addLibraryMemo(
  userId: string,
  ticker: string,
  opts: {
    title: string;
    markdown: string;
    variant?: string | null;
    provider?: string | null;
    llmModel?: string | null;
  }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  const id = crypto.randomUUID();
  const relMemoFile = `memos/${id}.md`;
  const path = `${LIB_PREFIX}/${relMemoFile}`;
  const w = await workspaceWriteUtf8(userId, sym, path, opts.markdown);
  if (!w.ok) return w;
  const entries = await readLibraryIndex(userId, ticker);
  entries.unshift({
    id,
    kind: "memo",
    title: opts.title.trim().slice(0, 500) || "Credit memo",
    createdAt: new Date().toISOString(),
    variant: opts.variant ?? undefined,
    provider: opts.provider ?? undefined,
    llmModel: opts.llmModel?.trim() ? opts.llmModel.trim().slice(0, 200) : undefined,
    memoFile: relMemoFile,
  });
  const idx = await writeLibraryIndex(userId, ticker, entries);
  if (!idx.ok) {
    await workspaceDeleteFile(userId, sym, path);
    return idx;
  }
  return { ok: true, id };
}

const MAX_DECK_BYTES = 48 * 1024 * 1024;

export async function addLibraryDeck(
  userId: string,
  ticker: string,
  opts: { title: string; pptx: Buffer; provider?: string | null; llmModel?: string | null }
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (opts.pptx.length > MAX_DECK_BYTES) {
    return { ok: false, error: `Deck file too large (max ${MAX_DECK_BYTES / (1024 * 1024)} MB)` };
  }
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  const id = crypto.randomUUID();
  const relDeck = `decks/${id}.pptx`;
  const path = `${LIB_PREFIX}/${relDeck}`;
  const w = await workspaceWriteFile(userId, sym, path, opts.pptx);
  if (!w.ok) return w;
  const entries = await readLibraryIndex(userId, ticker);
  entries.unshift({
    id,
    kind: "deck",
    title: opts.title.trim().slice(0, 500) || "Credit deck",
    createdAt: new Date().toISOString(),
    provider: opts.provider?.trim() ? opts.provider.trim().slice(0, 40) : undefined,
    llmModel: opts.llmModel?.trim() ? opts.llmModel.trim().slice(0, 200) : undefined,
    deckFile: relDeck,
  });
  const idx = await writeLibraryIndex(userId, ticker, entries);
  if (!idx.ok) {
    await workspaceDeleteFile(userId, sym, path);
    return idx;
  }
  return { ok: true, id };
}

export async function deleteLibraryEntry(
  userId: string,
  ticker: string,
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Invalid id" };
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  const entries = await readLibraryIndex(userId, ticker);
  const idx = entries.findIndex((e) => e.id === id);
  if (idx < 0) return { ok: false, error: "Not found" };
  const [removed] = entries.splice(idx, 1);
  const rel = removed.kind === "memo" ? removed.memoFile : removed.deckFile;
  const filePath = `${LIB_PREFIX}/${rel}`;
  await workspaceDeleteFile(userId, sym, filePath);
  const w = await writeLibraryIndex(userId, ticker, entries);
  return w.ok ? { ok: true } : { ok: false, error: "Failed to update index" };
}

export async function readLibraryMemoContent(userId: string, ticker: string, id: string): Promise<string | null> {
  if (!UUID_RE.test(id)) return null;
  const entries = await readLibraryIndex(userId, ticker);
  const e = entries.find((x) => x.id === id && x.kind === "memo");
  if (!e || e.kind !== "memo") return null;
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  return workspaceReadUtf8(userId, sym, `${LIB_PREFIX}/${e.memoFile}`);
}

export async function readLibraryDeckBuffer(userId: string, ticker: string, id: string): Promise<Buffer | null> {
  if (!UUID_RE.test(id)) return null;
  const entries = await readLibraryIndex(userId, ticker);
  const e = entries.find((x) => x.id === id && x.kind === "deck");
  if (!e || e.kind !== "deck") return null;
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const buf = await workspaceReadFile(userId, sym, `${LIB_PREFIX}/${e.deckFile}`);
  return buf ?? null;
}
