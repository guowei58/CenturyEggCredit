import type { EnvRiskRuntimeConfig } from "@/lib/env-risk/config";
import type { EchoFacilityRaw } from "@/lib/env-risk/types";

const GET_FACILITIES = "https://echodata.epa.gov/echo/echo_rest_services.get_facilities";
const GET_QID = "https://echodata.epa.gov/echo/echo_rest_services.get_qid";

async function fetchJson(url: string, cfg: EnvRiskRuntimeConfig): Promise<unknown> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), cfg.requestTimeoutMs);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": cfg.epaUserAgent, Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

type GetFacilitiesResponse = {
  Results?: {
    Message?: string;
    Error?: { ErrorMessage?: string };
    QueryID?: string;
    QueryRows?: string;
  };
};

type GetQidResponse = {
  Results?: {
    Message?: string;
    Error?: { ErrorMessage?: string };
    Facilities?: EchoFacilityRaw[];
  };
};

function buildFallbackFragments(name: string): string[] {
  const base = name.trim();
  const cleaned = base.replace(/[.,/#!$%^&*;:{}=_`~()]/g, " ").replace(/\s+/g, " ").trim();
  const noSuffix = cleaned
    .replace(/\b(incorporated|inc|corp|corporation|company|co|llc|ltd|limited|plc|holdings)\b\.?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const tokens = noSuffix.split(/\s+/).filter((t) => t.length > 2);
  return [base, cleaned, noSuffix, tokens.slice(0, 2).join(" "), tokens[0] ?? ""]
    .map((s) => s.trim())
    .filter((s, i, arr) => s.length >= 3 && arr.indexOf(s) === i);
}

export async function echoSearchFacilitiesByName(
  name: string,
  cfg: EnvRiskRuntimeConfig,
  options?: { state?: string }
): Promise<{ facilities: EchoFacilityRaw[]; query_id: string | null; error: string | null; requestUrl: string }> {
  const q = name.trim().slice(0, 80);
  if (q.length < 3) return { facilities: [], query_id: null, error: "Name too short", requestUrl: "" };
  const st = options?.state?.trim().toUpperCase();
  let first: GetFacilitiesResponse;
  let lastError = "ECHO get_facilities failed";
  let lastUrl = "";
  for (const candidate of buildFallbackFragments(q)) {
    let u = `${GET_FACILITIES}?output=JSON&p_fn=${encodeURIComponent(candidate)}`;
    if (st && st.length === 2) u += `&p_st=${encodeURIComponent(st)}`;
    lastUrl = u;
    try {
      first = (await fetchJson(u, cfg)) as GetFacilitiesResponse;
    } catch (e) {
      lastError = e instanceof Error ? e.message : "ECHO get_facilities failed";
      continue;
    }
    const err = first.Results?.Error?.ErrorMessage;
    if (err) {
      lastError = err;
      continue;
    }
    const rawQid = first.Results?.QueryID;
    const qid = rawQid == null ? "" : String(rawQid).trim();
    if (!qid) {
      lastError = "No QueryID from ECHO";
      continue;
    }

    const page = `${GET_QID}?output=JSON&qid=${encodeURIComponent(qid)}&p_rows_start=1&p_rows_end=${cfg.echoPageSize}`;
    try {
      const second = (await fetchJson(page, cfg)) as GetQidResponse;
      const e2 = second.Results?.Error?.ErrorMessage;
      if (e2) {
        lastError = e2;
        continue;
      }
      const fac = second.Results?.Facilities;
      return { facilities: Array.isArray(fac) ? fac : [], query_id: qid, error: null, requestUrl: u };
    } catch (e) {
      lastError = e instanceof Error ? e.message : "ECHO get_qid failed";
      continue;
    }
  }
  return { facilities: [], query_id: null, error: lastError, requestUrl: lastUrl };
}

export function echoFacilityDetailUrl(registryId: string): string {
  return `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(registryId)}`;
}
