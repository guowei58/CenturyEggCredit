import type { WorkProductIngestTabKind } from "@/lib/work-product-ingest-additions";

/** Apply saved extra-source picker selections before Refresh sources / memo ingest. */
export async function applyWorkProductIngestPending(
  kind: WorkProductIngestTabKind,
  ticker: string
): Promise<boolean> {
  const sym = (ticker ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) return false;
  try {
    const res = await fetch(
      `/api/work-product-ingest/${encodeURIComponent(kind)}/${encodeURIComponent(sym)}`,
      { method: "POST" }
    );
    return res.ok;
  } catch {
    return false;
  }
}
