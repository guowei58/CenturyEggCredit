export type WorkProductSourceProgressPhase =
  | "starting"
  | "loading"
  | "extracting"
  | "extras"
  | "done";

export type WorkProductSourceProgress = {
  phase: WorkProductSourceProgressPhase;
  detail: string;
  done: number;
  total: number;
  updatedAt: number;
};

const TTL_MS = 10 * 60 * 1000;
const progressByKey = new Map<string, WorkProductSourceProgress>();

export function workProductSourceProgressKey(userId: string, kind: string, ticker: string): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${userId}:${kind.trim().toLowerCase()}:${sym}`;
}

function pruneStale(now = Date.now()): void {
  for (const [key, value] of progressByKey) {
    if (now - value.updatedAt > TTL_MS) progressByKey.delete(key);
  }
}

export function getWorkProductSourceProgress(key: string): WorkProductSourceProgress | null {
  pruneStale();
  return progressByKey.get(key) ?? null;
}

export function setWorkProductSourceProgress(
  key: string,
  update: Omit<WorkProductSourceProgress, "updatedAt"> & { updatedAt?: number }
): void {
  pruneStale();
  progressByKey.set(key, {
    phase: update.phase,
    detail: update.detail,
    done: update.done,
    total: update.total,
    updatedAt: update.updatedAt ?? Date.now(),
  });
}

export function clearWorkProductSourceProgress(key: string): void {
  progressByKey.delete(key);
}

export async function runWorkProductInventoryGather<T>(params: {
  userId: string;
  kind: string;
  ticker: string;
  gather: (progressKey: string) => Promise<T>;
}): Promise<T> {
  const key = workProductSourceProgressKey(params.userId, params.kind, params.ticker);
  setWorkProductSourceProgress(key, {
    phase: "starting",
    detail: "Starting source scan…",
    done: 0,
    total: 0,
  });
  try {
    const result = await params.gather(key);
    setWorkProductSourceProgress(key, {
      phase: "done",
      detail: "Source scan complete",
      done: 1,
      total: 1,
    });
    return result;
  } catch (e) {
    clearWorkProductSourceProgress(key);
    throw e;
  }
}
