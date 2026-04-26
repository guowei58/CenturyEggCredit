import { createHash } from "crypto";

import { deleteKpiEmbeddingsFile } from "./kpiRetrieval";
import { stripCorpusFromProject, type CreditMemoProject, type MemoJob } from "./types";
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";

const STATE_PATH = "credit-memo/state.json";

type DbState = {
  projects: CreditMemoProject[];
  jobs: MemoJob[];
};

function empty(): DbState {
  return { projects: [], jobs: [] };
}

async function readDb(userId: string): Promise<DbState> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, STATE_PATH);
  if (!raw?.trim()) return empty();
  try {
    return JSON.parse(raw) as DbState;
  } catch {
    return empty();
  }
}

async function writeDb(userId: string, state: DbState): Promise<void> {
  const w = await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, STATE_PATH, JSON.stringify(state, null, 2));
  if (!w.ok) throw new Error(w.error);
}

function upsertProject(db: DbState, p: CreditMemoProject): void {
  const i = db.projects.findIndex((x) => x.id === p.id);
  if (i === -1) db.projects.push(p);
  else db.projects[i] = p;
}

export async function saveProject(userId: string, project: CreditMemoProject): Promise<void> {
  const db = await readDb(userId);
  upsertProject(db, project);
  await writeDb(userId, db);
}

/** After a work product is saved, drop ingested text from server-backed project state so it is not kept on disk. */
export async function clearIngestCorpusAfterWorkProduct(
  userId: string,
  projectId: string | null | undefined
): Promise<void> {
  const id = typeof projectId === "string" ? projectId.trim() : "";
  if (!id) return;
  const p = await getProject(userId, id);
  if (!p) return;
  try {
    await deleteKpiEmbeddingsFile(userId, id);
  } catch {
    /* best-effort */
  }
  await saveProject(userId, stripCorpusFromProject(p));
}

export async function getProject(userId: string, id: string): Promise<CreditMemoProject | null> {
  const db = await readDb(userId);
  return db.projects.find((p) => p.id === id) ?? null;
}

/** Most recently updated ingested project for this ticker (for reference tabs when draft has no project). */
export async function getLatestProjectForTicker(userId: string, ticker: string): Promise<CreditMemoProject | null> {
  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;
  const db = await readDb(userId);
  const matches = db.projects.filter((p) => p.ticker.trim().toUpperCase() === sym);
  if (matches.length === 0) return null;
  matches.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  return matches[0] ?? null;
}

export async function appendJob(userId: string, job: MemoJob): Promise<void> {
  const db = await readDb(userId);
  db.jobs = db.jobs.filter((j) => j.id !== job.id);
  db.jobs.push(job);
  await writeDb(userId, db);
}

export async function getJob(userId: string, id: string): Promise<MemoJob | null> {
  const db = await readDb(userId);
  return db.jobs.find((j) => j.id === id) ?? null;
}

export function newJobId(): string {
  return createHash("sha256").update(`job|${Date.now()}|${Math.random()}`).digest("hex").slice(0, 24);
}
