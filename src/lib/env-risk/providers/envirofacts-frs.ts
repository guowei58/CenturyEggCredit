import type { EnvRiskRuntimeConfig } from "@/lib/env-risk/config";

export type FrsSiteRow = {
  registry_id: string | null;
  primary_name: string | null;
  state_code: string | null;
  city_name: string | null;
  location_address: string | null;
  std_loc_address: string | null;
};

function buildFallbackFragments(nameFragment: string): string[] {
  const base = nameFragment.trim();
  const cleaned = base.replace(/[.,/#!$%^&*;:{}=_`~()]/g, " ").replace(/\s+/g, " ").trim();
  const noSuffix = cleaned
    .replace(/\b(incorporated|inc|corp|corporation|company|co|llc|ltd|limited|plc|holdings)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = noSuffix.split(/\s+/).filter((t) => t.length > 2);
  const out = [base, cleaned, noSuffix, tokens.slice(0, 2).join(" "), tokens[0] ?? ""]
    .map((s) => s.trim())
    .filter((s, i, arr) => s.length >= 3 && arr.indexOf(s) === i);
  return out;
}

function buildUrl(contains: string, start: number, count: number, state?: string): string {
  const enc = encodeURIComponent(contains.trim().slice(0, 48));
  const base = "https://data.epa.gov/efservice/frs.FRS_FACILITY_SITE";
  const st = state?.trim().toUpperCase();
  if (st && st.length === 2) {
    return `${base}/state_code/equals/${encodeURIComponent(st)}/and/primary_name/contains/${enc}/${start}:${count}/json`;
  }
  return `${base}/primary_name/contains/${enc}/${start}:${count}/json`;
}

export async function frsSearchFacilityNameContains(
  nameFragment: string,
  cfg: EnvRiskRuntimeConfig,
  maxRows = 15,
  options?: { state?: string }
): Promise<{ rows: FrsSiteRow[]; error: string | null; requestUrl: string }> {
  const frag = nameFragment.trim();
  if (frag.length < 3) {
    return { rows: [], error: "Fragment too short", requestUrl: "" };
  }
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
  try {
    let lastError = "FRS request failed";
    let lastUrl = "";
    for (const candidate of buildFallbackFragments(frag)) {
      const u = buildUrl(candidate, 0, maxRows, options?.state);
      lastUrl = u;
      const res = await fetch(u, {
        headers: { "User-Agent": cfg.epaUserAgent, Accept: "application/json" },
        signal: ctrl.signal,
        cache: "no-store",
      });
      const text = await res.text();
      if (!res.ok) {
        lastError = `FRS HTTP ${res.status}`;
        if (res.status >= 500) continue;
        return { rows: [], error: lastError, requestUrl: u };
      }
      const j = JSON.parse(text) as unknown;
      if (j && typeof j === "object" && "error" in j) {
        lastError = String((j as { error: string }).error);
        continue;
      }
      if (!Array.isArray(j)) {
        lastError = "Unexpected FRS JSON shape";
        continue;
      }
      const rows: FrsSiteRow[] = (j as Record<string, unknown>[]).map((r) => ({
        registry_id: r.registry_id != null ? String(r.registry_id) : null,
        primary_name: r.primary_name != null ? String(r.primary_name) : null,
        state_code: r.state_code != null ? String(r.state_code) : null,
        city_name: r.city_name != null ? String(r.city_name) : null,
        location_address: r.location_address != null ? String(r.location_address) : null,
        std_loc_address: r.std_loc_address != null ? String(r.std_loc_address) : null,
      }));
      return { rows, error: null, requestUrl: u };
    }
    return { rows: [], error: lastError, requestUrl: lastUrl };
  } catch (e) {
    return {
      rows: [],
      error: e instanceof Error ? e.message : "FRS request failed",
      requestUrl: "",
    };
  } finally {
    clearTimeout(t);
  }
}
