import { createHash } from "crypto";

import type { CreditMemoProject, MemoJob } from "./types";
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

export async function getProject(userId: string, id: string): Promise<CreditMemoProject | null> {
  const db = await readDb(userId);
  return db.projects.find((p) => p.id === id) ?? null;
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
