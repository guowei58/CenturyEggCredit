import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";

import type { ResearchResult, ResearchSearch } from "../types";

const DB_REL_PATH = "research-finder/db.json";

type DbState = {
  searches: ResearchSearch[];
  results: ResearchResult[];
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

function upsertById<T extends { id: string }>(arr: T[], item: T): T[] {
  const i = arr.findIndex((x) => x.id === item.id);
  if (i === -1) return [...arr, item];
  const next = [...arr];
  next[i] = item;
  return next;
}

export async function upsertSearch(userId: string, search: ResearchSearch): Promise<void> {
  const db = await readState(userId);
  db.searches = upsertById(db.searches, search);
  await writeState(userId, db);
}

export async function replaceResultsForSearch(userId: string, searchId: string, results: ResearchResult[]): Promise<void> {
  const db = await readState(userId);
  db.results = db.results.filter((r) => r.search_id !== searchId).concat(results);
  await writeState(userId, db);
}

export async function getSearch(userId: string, id: string): Promise<ResearchSearch | null> {
  const db = await readState(userId);
  return db.searches.find((s) => s.id === id) ?? null;
}

export async function getResults(userId: string, searchId: string): Promise<ResearchResult[]> {
  const db = await readState(userId);
  return db.results.filter((r) => r.search_id === searchId).sort((a, b) => b.match_score - a.match_score);
}
