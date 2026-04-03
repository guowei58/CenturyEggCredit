import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";

import type { SubstackPost, SubstackPublication } from "../types";
import { nowIso, stableId } from "../utils";

const DB_REL_PATH = "substack/db.json";

type DbState = {
  publications: SubstackPublication[];
  posts: SubstackPost[];
};

function emptyState(): DbState {
  return { publications: [], posts: [] };
}

async function readState(userId: string): Promise<DbState> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, DB_REL_PATH);
  if (!raw) return emptyState();
  try {
    const data = JSON.parse(raw) as DbState;
    return {
      publications: Array.isArray(data.publications) ? data.publications : [],
      posts: Array.isArray(data.posts) ? data.posts : [],
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

export async function loadSubstackDb(userId: string): Promise<DbState> {
  return readState(userId);
}

export async function saveSubstackDb(userId: string, state: DbState): Promise<void> {
  await writeState(userId, state);
}

export async function upsertPublication(userId: string, pub: SubstackPublication): Promise<void> {
  const db = await readState(userId);
  db.publications = upsertById(db.publications, pub);
  await writeState(userId, db);
}

export async function upsertPublications(userId: string, pubs: SubstackPublication[]): Promise<void> {
  const db = await readState(userId);
  let cur = db.publications;
  for (const p of pubs) cur = upsertById(cur, p);
  db.publications = cur;
  await writeState(userId, db);
}

export async function upsertPosts(userId: string, posts: SubstackPost[]): Promise<void> {
  const db = await readState(userId);
  const byNorm = new Map(db.posts.map((p) => [p.normalizedUrl.toLowerCase(), p] as const));
  for (const p of posts) {
    const k = p.normalizedUrl.toLowerCase();
    const prev = byNorm.get(k);
    if (!prev) {
      byNorm.set(k, p);
      continue;
    }
    byNorm.set(k, {
      ...prev,
      ...p,
      source: prev.source === p.source ? prev.source : "rss",
      matchedTerms: Array.from(new Set([...(prev.matchedTerms ?? []), ...(p.matchedTerms ?? [])])),
      tickers: Array.from(new Set([...(prev.tickers ?? []), ...(p.tickers ?? [])])),
      companyMentions: Array.from(new Set([...(prev.companyMentions ?? []), ...(p.companyMentions ?? [])])),
      confidenceScore: Math.max(prev.confidenceScore ?? 0, p.confidenceScore ?? 0),
    });
  }
  db.posts = Array.from(byNorm.values());
  await writeState(userId, db);
}

export async function listPublications(
  userId: string,
  params?: { status?: string; offset?: number; limit?: number }
): Promise<{ total: number; publications: SubstackPublication[] }> {
  const db = await readState(userId);
  let pubs = db.publications;
  if (params?.status) pubs = pubs.filter((p) => p.status === params.status);
  pubs = pubs.sort(
    (a, b) =>
      (b.lastDiscoveredAt ?? "").localeCompare(a.lastDiscoveredAt ?? "") || (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0)
  );
  const offset = Math.max(0, params?.offset ?? 0);
  const limit = Math.min(200, Math.max(1, params?.limit ?? 50));
  return { total: pubs.length, publications: pubs.slice(offset, offset + limit) };
}

export async function getPublicationById(userId: string, id: string): Promise<SubstackPublication | null> {
  const db = await readState(userId);
  return db.publications.find((p) => p.id === id) ?? null;
}

export async function updatePublicationIngested(userId: string, id: string): Promise<void> {
  const db = await readState(userId);
  const p = db.publications.find((x) => x.id === id);
  if (!p) return;
  const now = nowIso();
  const next: SubstackPublication = { ...p, lastIngestedAt: now };
  db.publications = upsertById(db.publications, next);
  await writeState(userId, db);
}

export function computePublicationId(baseUrl: string): string {
  return stableId(["substack_pub", baseUrl.toLowerCase()]);
}
