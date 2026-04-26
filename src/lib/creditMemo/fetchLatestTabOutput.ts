import { fetchSavedFromServer } from "@/lib/saved-data-client";

const TAB_KEYS = {
  kpi: { md: "kpi-latest", meta: "kpi-latest-meta" },
  forensic: { md: "forensic-accounting-latest", meta: "forensic-accounting-latest-meta" },
  recommendation: { md: "cs-recommendation-latest", meta: "cs-recommendation-latest-meta" },
  literaryReferences: { md: "literary-references-latest", meta: "literary-references-latest-meta" },
  biblicalReferences: { md: "biblical-references-latest", meta: "biblical-references-latest-meta" },
} as const;

export type CreditMemoGeneratedTabKind = keyof typeof TAB_KEYS;

/** Load latest saved markdown + optional job id from server (same keys the generator routes write). */
export async function fetchLatestGeneratedTabOutput(
  ticker: string,
  kind: CreditMemoGeneratedTabKind
): Promise<{ markdown: string | null; jobId: string | null; contextSentUtf8Bytes: number | null }> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return { markdown: null, jobId: null, contextSentUtf8Bytes: null };
  const { md, meta } = TAB_KEYS[kind];
  const rawMd = await fetchSavedFromServer(tk, md);
  const metaRaw = await fetchSavedFromServer(tk, meta);
  let jobId: string | null = null;
  let contextSentUtf8Bytes: number | null = null;
  if (metaRaw?.trim()) {
    try {
      const o = JSON.parse(metaRaw) as { jobId?: string; contextSentUtf8Bytes?: number };
      if (typeof o.jobId === "string") jobId = o.jobId;
      if (typeof o.contextSentUtf8Bytes === "number" && Number.isFinite(o.contextSentUtf8Bytes)) {
        contextSentUtf8Bytes = o.contextSentUtf8Bytes;
      }
    } catch {
      /* ignore */
    }
  }
  const markdown = rawMd?.trim() ? rawMd : null;
  return { markdown, jobId, contextSentUtf8Bytes };
}
