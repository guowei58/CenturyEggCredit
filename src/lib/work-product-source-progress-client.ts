export type WorkProductSourceProgressSnapshot = {
  phase: string;
  detail: string;
  done: number;
  total: number;
};

export async function fetchWorkProductSourceProgress(
  kind: string,
  ticker: string
): Promise<WorkProductSourceProgressSnapshot | null> {
  const sym = encodeURIComponent(ticker.trim().toUpperCase());
  const res = await fetch(`/api/work-product-source-progress/${encodeURIComponent(kind)}/${sym}`);
  if (!res.ok) return null;
  const body = (await res.json()) as { progress?: WorkProductSourceProgressSnapshot | null };
  return body.progress ?? null;
}

export function pollWorkProductSourceProgress(
  kind: string,
  ticker: string,
  onUpdate: (progress: WorkProductSourceProgressSnapshot) => void,
  intervalMs = 450
): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    const progress = await fetchWorkProductSourceProgress(kind, ticker);
    if (progress) onUpdate(progress);
  };
  void tick();
  const id = window.setInterval(() => void tick(), intervalMs);
  return () => {
    stopped = true;
    window.clearInterval(id);
  };
}

export function formatWorkProductSourceProgressLine(progress: WorkProductSourceProgressSnapshot): string {
  return progress.detail.trim() || "Refreshing sources…";
}
