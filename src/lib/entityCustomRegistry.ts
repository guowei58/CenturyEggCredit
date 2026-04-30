import type { EntityRegistrySourceRow } from "@/lib/entitySourceRegistry";

export function parseCustomEntityRegistryEntries(raw: unknown): EntityRegistrySourceRow[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: EntityRegistrySourceRow[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.state !== "string" || typeof o.sourceName !== "string" || typeof o.sourceUrl !== "string") continue;
    const st = o.state.trim().toUpperCase();
    if (!st) continue;
    out.push({
      state: st,
      sourceName: o.sourceName,
      sourceUrl: o.sourceUrl,
      searchInstructions: typeof o.searchInstructions === "string" ? o.searchInstructions : "",
      requiresLogin: Boolean(o.requiresLogin),
      hasFees: Boolean(o.hasFees),
      supportsNameSearch: Boolean(o.supportsNameSearch !== false),
      supportsEntityIdSearch: Boolean(o.supportsEntityIdSearch),
      supportsAgentSearch: Boolean(o.supportsAgentSearch),
      supportsOfficerSearch: Boolean(o.supportsOfficerSearch),
      supportsAddressSearch: Boolean(o.supportsAddressSearch),
      supportsDocumentDownload: Boolean(o.supportsDocumentDownload !== false),
      notes: typeof o.notes === "string" ? o.notes : "",
    });
  }
  return out;
}
