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

export async function echoSearchFacilitiesByName(
  name: string,
  cfg: EnvRiskRuntimeConfig
): Promise<{ facilities: EchoFacilityRaw[]; query_id: string | null; error: string | null }> {
  const q = name.trim().slice(0, 80);
  if (q.length < 3) return { facilities: [], query_id: null, error: "Name too short" };
  const u = `${GET_FACILITIES}?output=JSON&p_fn=${encodeURIComponent(q)}`;
  let first: GetFacilitiesResponse;
  try {
    first = (await fetchJson(u, cfg)) as GetFacilitiesResponse;
  } catch (e) {
    return {
      facilities: [],
      query_id: null,
      error: e instanceof Error ? e.message : "ECHO get_facilities failed",
    };
  }
  const err = first.Results?.Error?.ErrorMessage;
  if (err) return { facilities: [], query_id: null, error: err };
  const qid = first.Results?.QueryID?.trim();
  if (!qid) return { facilities: [], query_id: null, error: "No QueryID from ECHO" };

  const page = `${GET_QID}?output=JSON&qid=${encodeURIComponent(qid)}&p_rows_start=1&p_rows_end=${cfg.echoPageSize}`;
  try {
    const second = (await fetchJson(page, cfg)) as GetQidResponse;
    const e2 = second.Results?.Error?.ErrorMessage;
    if (e2) return { facilities: [], query_id: qid, error: e2 };
    const fac = second.Results?.Facilities;
    return { facilities: Array.isArray(fac) ? fac : [], query_id: qid, error: null };
  } catch (e) {
    return {
      facilities: [],
      query_id: qid,
      error: e instanceof Error ? e.message : "ECHO get_qid failed",
    };
  }
}

export function echoFacilityDetailUrl(registryId: string): string {
  return `https://echo.epa.gov/detailed-facility-report?fid=${encodeURIComponent(registryId)}`;
}
