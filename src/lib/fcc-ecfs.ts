/**
 * FCC Electronic Comment Filing System (ECFS) — public API client.
 * @see https://www.fcc.gov/ecfs/help/public_api
 * API keys: https://api.data.gov/signup (same key works for publicapi.fcc.gov)
 */

export type EcfsFilingRecord = {
  id_submission: string;
  date_received: string | null;
  date_disseminated: string | null;
  submission_type: string;
  filer_names: string;
  proceedings: string;
  preview_text: string | null;
  view_url: string;
};

type RawFiler = { name?: string };
type RawProceeding = { name?: string; description?: string; description_display?: string };
type RawSubmissionType = { description?: string; short?: string };

type RawEcfsFiling = {
  id_submission?: string;
  date_received?: string;
  date_disseminated?: string;
  filers?: RawFiler[];
  proceedings?: RawProceeding[];
  submissiontype?: RawSubmissionType;
  text_data?: string;
};

function normalizeFiling(raw: RawEcfsFiling): EcfsFilingRecord | null {
  const id = raw.id_submission?.trim();
  if (!id) return null;
  const filerNames = (raw.filers ?? [])
    .map((f) => (typeof f?.name === "string" ? f.name.trim() : ""))
    .filter(Boolean)
    .join("; ");
  const procParts = (raw.proceedings ?? []).map((p) => {
    const code = typeof p?.name === "string" ? p.name.trim() : "";
    const desc =
      (typeof p?.description_display === "string" && p.description_display.trim()) ||
      (typeof p?.description === "string" && p.description.trim()) ||
      "";
    if (code && desc) return `${code} — ${desc}`;
    return code || desc || "";
  });
  const st = raw.submissiontype;
  const submissionType =
    (typeof st?.description === "string" && st.description.trim()) ||
    (typeof st?.short === "string" && st.short.trim()) ||
    "—";
  let preview: string | null = null;
  if (typeof raw.text_data === "string" && raw.text_data.trim()) {
    const t = raw.text_data.replace(/\s+/g, " ").trim();
    preview = t.length > 220 ? `${t.slice(0, 220)}…` : t;
  }
  return {
    id_submission: id,
    date_received: raw.date_received?.trim() ?? null,
    date_disseminated: raw.date_disseminated?.trim() ?? null,
    submission_type: submissionType,
    filer_names: filerNames || "—",
    proceedings: procParts.filter(Boolean).join(" | ") || "—",
    preview_text: preview,
    view_url: ecfsFilingPublicUrl(id),
  };
}

/** Best-effort public URL pattern used by the FCC ECFS site for a submission. */
export function ecfsFilingPublicUrl(idSubmission: string): string {
  return `https://www.fcc.gov/ecfs/filing/${encodeURIComponent(idSubmission)}`;
}

export function getFccEcfsApiKey(): string | null {
  const k =
    process.env.FCC_API_KEY?.trim() ||
    process.env.DATA_GOV_API_KEY?.trim() ||
    process.env.DATA_DOT_GOV_API_KEY?.trim();
  return k && k.length > 0 ? k : null;
}

function filerMatchesQuery(filerNames: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return filerNames.toLowerCase().includes(q);
}

function parseFilingsPayload(data: unknown): RawEcfsFiling[] {
  if (!data || typeof data !== "object") return [];
  const d = data as Record<string, unknown>;
  const f = d.filing;
  if (Array.isArray(f)) return f as RawEcfsFiling[];
  if (f && typeof f === "object") return [f as RawEcfsFiling];
  const fs = d.filings;
  if (Array.isArray(fs)) return fs as RawEcfsFiling[];
  return [];
}

export async function searchEcfsFilings(params: {
  apiKey: string;
  query: string;
  limit?: number;
  offset?: number;
}): Promise<
  | { ok: true; filings: EcfsFilingRecord[]; query_used: string; raw_count: number }
  | { ok: false; error: string; httpStatus?: number }
> {
  const { apiKey, query } = params;
  const limit = Math.min(Math.max(params.limit ?? 40, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);
  const q = query.trim();
  if (!q) return { ok: false, error: "Search query is empty." };

  const url = new URL("https://publicapi.fcc.gov/ecfs/filings");
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("q", q);
  url.searchParams.set("sort", "date_disseminated,DESC");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
      next: { revalidate: 0 },
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error calling FCC ECFS API." };
  }

  if (!res.ok) {
    let detail = "";
    try {
      detail = await res.text();
    } catch {
      // ignore
    }
    return {
      ok: false,
      error: `FCC ECFS API returned HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`,
      httpStatus: res.status,
    };
  }

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { ok: false, error: "FCC ECFS API returned invalid JSON." };
  }

  const rawList = parseFilingsPayload(data);
  const normalized = rawList.map(normalizeFiling).filter((x): x is EcfsFilingRecord => x != null);

  const qLower = q.toLowerCase();
  normalized.sort((a, b) => {
    const aF = filerMatchesQuery(a.filer_names, q) ? 1 : 0;
    const bF = filerMatchesQuery(b.filer_names, q) ? 1 : 0;
    if (aF !== bF) return bF - aF;
    const da = Date.parse(a.date_disseminated || a.date_received || "") || 0;
    const db = Date.parse(b.date_disseminated || b.date_received || "") || 0;
    return db - da;
  });

  return { ok: true, filings: normalized, query_used: q, raw_count: normalized.length };
}
