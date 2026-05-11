import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type EiaRoute = {
  id?: string;
  name?: string;
  description?: string;
};

type EiaMetaResponse = {
  response?: {
    id?: string;
    name?: string;
    description?: string;
    routes?: EiaRoute[];
  };
};

type EiaDataResponse = {
  response?: {
    data?: Array<Record<string, unknown>>;
    total?: number | string;
    dateFormat?: string;
  };
};

function rid() {
  return `eia_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function apiKey(): string | undefined {
  return process.env.EIA_API_KEY?.trim();
}

function browserUrl(pathParts: string[]): string {
  return `https://www.eia.gov/opendata/browser/${pathParts.join("/")}`;
}

async function fetchRouteMeta(pathParts: string[], key: string): Promise<EiaMetaResponse> {
  const url = new URL(`https://api.eia.gov/v2/${pathParts.length ? `${pathParts.join("/")}/` : ""}`);
  url.searchParams.set("api_key", key);
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`EIA request failed (HTTP ${res.status}).`);
  }
  return (await res.json()) as EiaMetaResponse;
}

async function fetchRouteSample(pathParts: string[], key: string): Promise<{ sample: string; period?: string; total?: number | string } | null> {
  const url = new URL(`https://api.eia.gov/v2/${pathParts.join("/")}/data/`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("length", "3");
  url.searchParams.set("sort[0][column]", "period");
  url.searchParams.set("sort[0][direction]", "desc");
  const res = await fetch(url.toString(), { cache: "no-store" });
  if (!res.ok) return null;
  const raw = (await res.json().catch(() => null)) as EiaDataResponse | null;
  const rows = raw?.response?.data ?? [];
  if (!rows.length) return null;
  const first = rows[0] ?? {};
  const preview = rows
    .slice(0, 3)
    .map((row) => {
      const entries = Object.entries(row)
        .filter(([key]) => !["period", "series-description", "seriesDescription"].includes(key))
        .slice(0, 3)
        .map(([key, value]) => `${key}=${String(value ?? "").trim()}`);
      const period = String(row.period ?? "").trim();
      return [period, ...entries].filter(Boolean).join(" ");
    })
    .filter(Boolean)
    .join(" | ");
  return { sample: preview, period: String(first.period ?? "").trim() || undefined, total: raw?.response?.total };
}

export const eiaAdapter: RegulatoryAgencyAdapter = {
  sourceId: "eia",
  validateConfig: () => {
    const key = apiKey();
    if (!key) {
      return {
        ok: false,
        mode: "missing_key",
        message: "Set EIA_API_KEY in .env.local.",
        envKeyName: "EIA_API_KEY",
      };
    }
    return { ok: true, mode: "api_key", message: "Using EIA API v2 route metadata search." };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const key = apiKey();
    if (!key) {
      return { ok: false, error: "EIA API key missing.", hint: "Set EIA_API_KEY in .env.local and restart." };
    }

    const rootUrl = "https://api.eia.gov/v2/";
    const root = await fetchRouteMeta([], key);
    const topRoutes = Array.isArray(root.response?.routes) ? root.response?.routes ?? [] : [];

    const childMetas = await Promise.all(
      topRoutes.map(async (r) => {
        const routeId = String(r.id ?? "").trim();
        if (!routeId) return null;
        try {
          return { parent: r, meta: await fetchRouteMeta([routeId], key) };
        } catch {
          return { parent: r, meta: undefined };
        }
      })
    );

    const retrievedAt = new Date().toISOString();
    const datasetRows: RegulatorySearchResult[] = [];

    for (const entry of childMetas) {
      if (!entry) continue;
      const parentId = String(entry.parent.id ?? "").trim();
      const parentName = String(entry.parent.name ?? parentId).trim();
      const parentDesc = String(entry.parent.description ?? "").trim();
      const children = Array.isArray(entry.meta?.response?.routes) ? entry.meta?.response?.routes ?? [] : [];

      if (children.length === 0) {
        const confidence = matchConfidenceFromQuery(q, [parentName, parentDesc, parentId]);
        datasetRows.push({
          result_id: rid(),
          source_id: "eia",
          source_name: "EIA",
          agency: "EIA",
          category: "Energy Market Data",
          query_used: q,
          matched_entity: parentName || q,
          matched_entity_confidence: confidence,
          title: parentName || parentId || "EIA dataset",
          record_type: "dataset",
          record_subtype: parentId || undefined,
          description: parentDesc || undefined,
          detail_url: browserUrl([parentId]),
          raw_source_url: browserUrl([parentId]),
          raw_json: entry.meta ?? entry.parent,
          confidence,
          importance_score: 0,
          retrieved_at: retrievedAt,
          request_url: rootUrl,
        });
        continue;
      }

      for (const child of children) {
        const childId = String(child.id ?? "").trim();
        if (!childId) continue;
        const childName = String(child.name ?? childId).trim();
        const childDesc = String(child.description ?? "").trim();
        const confidence = matchConfidenceFromQuery(q, [parentName, parentDesc, childName, childDesc, childId]);

        datasetRows.push({
          result_id: rid(),
          source_id: "eia",
          source_name: "EIA",
          agency: "EIA",
          category: "Energy Market Data",
          query_used: q,
          matched_entity: childName || parentName || q,
          matched_entity_confidence: confidence,
          title: childName || childId || "EIA dataset",
          record_type: "dataset",
          record_subtype: [parentName, childId].filter(Boolean).join(" / ") || undefined,
          description: childDesc || parentDesc || undefined,
          detail_url: browserUrl([parentId, childId]),
          raw_source_url: browserUrl([parentId, childId]),
          raw_json: { parent: entry.parent, child, meta: entry.meta?.response },
          confidence,
          importance_score: confidence === "High" ? 80 : confidence === "Medium" ? 40 : 10,
          notes: params.state?.trim()
            ? `Selected state: ${params.state.trim().toUpperCase()} (browse this route in EIA for state-specific facets if available).`
            : undefined,
          retrieved_at: retrievedAt,
          request_url: rootUrl,
        });
      }
    }

    const sorted = [...datasetRows].sort((a, b) => {
      const rank = (v: string) => (v === "High" ? 2 : v === "Medium" ? 1 : 0);
      const diff = rank(b.confidence) - rank(a.confidence);
      if (diff !== 0) return diff;
      return a.title.localeCompare(b.title);
    });

    const top = sorted.slice(0, 25);
    const sampleCandidates = top.slice(0, 8);
    const samples = await Promise.allSettled(
      sampleCandidates.map(async (row) => {
        const rawRow = row.raw_json as Record<string, unknown>;
        const parent = rawRow?.parent as Record<string, unknown> | undefined;
        const child = rawRow?.child as Record<string, unknown> | undefined;
        const parentId = String(parent?.id ?? "").trim();
        const childId = String(child?.id ?? "").trim();
        const pathParts = [parentId, childId].filter(Boolean);
        if (!pathParts.length) return null;
        const sample = await fetchRouteSample(pathParts, key);
        if (!sample) return null;
        return { title: row.title, sample };
      })
    );
    const sampleByTitle = new Map<string, { sample: string; period?: string; total?: number | string }>();
    for (const result of samples) {
      if (result.status !== "fulfilled" || !result.value?.title || !result.value.sample) continue;
      sampleByTitle.set(result.value.title, result.value.sample);
    }
    const enrichedTop = top.map((row) => {
      const sample = sampleByTitle.get(row.title);
      if (!sample) return row;
      return {
        ...row,
        last_updated: sample.period ?? row.last_updated,
        source_quote: sample.sample,
        notes: [row.notes, sample.total != null ? `Series rows available: ${sample.total}` : ""].filter(Boolean).join(" · ") || undefined,
      };
    });
    const warnings: string[] = [];
    if (!sorted.some((r) => r.confidence !== "Low")) {
      warnings.push("EIA Open Data is dataset-centric rather than company-centric; showing browseable energy datasets because your query did not closely match route metadata.");
    }
    if (params.state?.trim()) {
      warnings.push("When a dataset supports a state facet, the selected state is shown as context, but this adapter is browsing route metadata rather than querying a state data table directly.");
    }

    if (sampleByTitle.size === 0) {
      warnings.push("Live EIA data previews were unavailable for the matched routes, so some results may remain metadata-only.");
    }

    return { ok: true, requestUrl: rootUrl, raw: { root, count: datasetRows.length }, results: enrichedTop, warnings: warnings.length ? warnings : undefined };
  },
};
