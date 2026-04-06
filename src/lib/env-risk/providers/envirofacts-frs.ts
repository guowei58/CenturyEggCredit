import type { EnvRiskRuntimeConfig } from "@/lib/env-risk/config";

export type FrsSiteRow = {
  registry_id: string | null;
  primary_name: string | null;
  state_code: string | null;
  city_name: string | null;
  location_address: string | null;
  std_loc_address: string | null;
};

function buildUrl(contains: string, start: number, count: number): string {
  const enc = encodeURIComponent(contains.trim().slice(0, 48));
  return `https://data.epa.gov/efservice/frs.FRS_FACILITY_SITE/primary_name/contains/${enc}/${start}:${count}/json`;
}

export async function frsSearchFacilityNameContains(
  nameFragment: string,
  cfg: EnvRiskRuntimeConfig,
  maxRows = 15
): Promise<{ rows: FrsSiteRow[]; error: string | null }> {
  const frag = nameFragment.trim();
  if (frag.length < 3) return { rows: [], error: "Fragment too short" };
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
  try {
    const res = await fetch(buildUrl(frag, 0, maxRows), {
      headers: { "User-Agent": cfg.epaUserAgent, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) return { rows: [], error: `FRS HTTP ${res.status}` };
    const j = JSON.parse(text) as unknown;
    if (j && typeof j === "object" && "error" in j) {
      return { rows: [], error: String((j as { error: string }).error) };
    }
    if (!Array.isArray(j)) return { rows: [], error: "Unexpected FRS JSON shape" };
    const rows: FrsSiteRow[] = (j as Record<string, unknown>[]).map((r) => ({
      registry_id: r.registry_id != null ? String(r.registry_id) : null,
      primary_name: r.primary_name != null ? String(r.primary_name) : null,
      state_code: r.state_code != null ? String(r.state_code) : null,
      city_name: r.city_name != null ? String(r.city_name) : null,
      location_address: r.location_address != null ? String(r.location_address) : null,
      std_loc_address: r.std_loc_address != null ? String(r.std_loc_address) : null,
    }));
    return { rows, error: null };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : "FRS request failed",
    };
  } finally {
    clearTimeout(t);
  }
}
