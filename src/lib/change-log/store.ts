import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import type { ChangeLogStore } from "./types";
import { CHANGE_LOG_DATA_VERSION } from "./types";

export const CHANGE_LOG_DATA_KEY = "change-log-data" as const;

export function emptyChangeLogStore(): ChangeLogStore {
  return {
    v: CHANGE_LOG_DATA_VERSION,
    lastChangeLogUpdatedAt: null,
    currentUpdateStartedAt: null,
    currentUpdateCompletedAt: null,
    draft: null,
    updates: [],
  };
}

export function parseChangeLogStore(raw: string | null | undefined): ChangeLogStore {
  if (!raw?.trim()) return emptyChangeLogStore();
  try {
    const parsed = JSON.parse(raw) as Partial<ChangeLogStore>;
    if (parsed.v !== CHANGE_LOG_DATA_VERSION) return emptyChangeLogStore();
    return {
      v: CHANGE_LOG_DATA_VERSION,
      lastChangeLogUpdatedAt:
        typeof parsed.lastChangeLogUpdatedAt === "string" ? parsed.lastChangeLogUpdatedAt : null,
      currentUpdateStartedAt:
        typeof parsed.currentUpdateStartedAt === "string" ? parsed.currentUpdateStartedAt : null,
      currentUpdateCompletedAt:
        typeof parsed.currentUpdateCompletedAt === "string" ? parsed.currentUpdateCompletedAt : null,
      draft: parsed.draft && typeof parsed.draft === "object" ? parsed.draft : null,
      updates: Array.isArray(parsed.updates) ? parsed.updates : [],
    };
  } catch {
    return emptyChangeLogStore();
  }
}

export async function readChangeLogStore(
  ticker: string,
  userId: string
): Promise<ChangeLogStore> {
  const raw = await readSavedContent(ticker, CHANGE_LOG_DATA_KEY, userId);
  return parseChangeLogStore(raw);
}

export async function writeChangeLogStore(
  ticker: string,
  userId: string,
  store: ChangeLogStore
): Promise<{ ok: true } | { ok: false; error: string }> {
  return writeSavedContent(ticker, CHANGE_LOG_DATA_KEY, JSON.stringify(store, null, 2), userId);
}

export function collectPriorDedupeKeys(store: ChangeLogStore): Set<string> {
  const keys = new Set<string>();
  for (const update of store.updates) {
    for (const entry of update.entries ?? []) {
      if (entry.dedupeKey) keys.add(entry.dedupeKey);
    }
  }
  return keys;
}
