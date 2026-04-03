import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";

import type { RedditPostResult, RedditSearch } from "../types";

const DB_REL_PATH = "reddit/db.json";

type DbState = {
  searches: RedditSearch[];
  results: RedditPostResult[];
};

function emptyState(): DbState {
  return { searches: [], results: [] };
}

async function readState(userId: string): Promise<DbState> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, DB_REL_PATH);
  if (!raw) return emptyState();
  try {
    const data = JSON.parse(raw) as DbState;
    return {
      searches: Array.isArray(data.searches) ? data.searches : [],
      results: Array.isArray(data.results) ? data.results : [],
    };
  } catch {
    return emptyState();
  }
}

async function writeState(userId: string, state: DbState): Promise<void> {
  await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, DB_REL_PATH, JSON.stringify(state, null, 2));
}

async function saveRedditDb(userId: string, state: DbState): Promise<void> {
  await writeState(userId, state);
}

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const next = [...arr];
  next[i] = item;
  return next;
}

export async function getSearchByCacheKey(
  userId: string,
  cacheKey: string,
  ttlMs: number
): Promise<{ search: RedditSearch; results: RedditPostResult[] } | null> {
  const db = await readState(userId);
  const now = Date.now();
  for (const s of db.searches) {
    if (s.cache_key !== cacheKey || s.status !== "completed") continue;
    if (!s.completed_at) continue;
    const completed = new Date(s.completed_at).getTime();
    if (!Number.isFinite(completed) || now - completed > ttlMs) continue;
    const results = db.results.filter((r) => r.search_id === s.id);
    return { search: s, results };
  }
  return null;
}

export async function getSearchById(userId: string, id: string): Promise<RedditSearch | null> {
  const db = await readState(userId);
  return db.searches.find((s) => s.id === id) ?? null;
}

export async function listResultsBySearchId(userId: string, searchId: string): Promise<RedditPostResult[]> {
  const db = await readState(userId);
  return db.results.filter((r) => r.search_id === searchId);
}

export async function saveSearchAndResults(
  userId: string,
  search: RedditSearch,
  results: RedditPostResult[]
): Promise<void> {
  const db = await readState(userId);
  const searches = upsertById(db.searches, search);
  const without = db.results.filter((r) => r.search_id !== search.id);
  const next: DbState = {
    searches,
    results: [...without, ...results],
  };
  await saveRedditDb(userId, next);
}
