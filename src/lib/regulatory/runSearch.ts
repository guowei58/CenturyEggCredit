import { getRegulatorySource } from "@/lib/regulatory/registry";
import { getRegulatoryAdapter } from "@/lib/regulatory/adapters";
import type { RegulatorySearchParams } from "@/lib/regulatory/types";

export function validateSourceId(sourceId: string): { ok: true } | { ok: false; error: string } {
  const s = getRegulatorySource(sourceId);
  if (!s) return { ok: false, error: `Unknown source_id: ${sourceId}` };
  return { ok: true };
}

export async function runRegulatorySearch(sourceId: string, params: RegulatorySearchParams) {
  const v = validateSourceId(sourceId);
  if (!v.ok) return { ok: false as const, error: v.error };
  const adapter = getRegulatoryAdapter(sourceId);
  const cfg = adapter.validateConfig();
  return { ok: true as const, config: cfg, response: await adapter.search(params) };
}

