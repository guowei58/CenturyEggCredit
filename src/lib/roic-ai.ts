/**
 * Server-only Roic AI RQL client.
 * @see https://roic.gitbook.io/api/roic-query-language/getting-started
 */

const ROIC_RQL_URL = "https://api.roic.ai/v1/rql/";

/** Strip characters that break RQL `for('…')` strings. */
export function sanitizeRoicSymbolForRql(symbol: string): string {
  return symbol.replace(/'/g, "").trim();
}

/** Map app ticker (e.g. MSFT) to Roic symbol (e.g. MSFT US). Override full symbol via ROIC_AI_SYMBOL_OVERRIDE for all requests, or pass ?symbol= on API routes / UI. */
export function formatTickerForRoic(ticker: string): string {
  const raw = ticker.trim().toUpperCase();
  if (!raw) return raw;
  if (/\s/.test(raw)) return raw;
  const suffix = process.env.ROIC_AI_TICKER_SUFFIX?.trim();
  if (suffix) return `${raw}${suffix.startsWith(" ") ? "" : " "}${suffix}`.replace(/\s+/g, " ").trim();
  return `${raw} US`;
}

/**
 * Ordered Roic identifiers to try when the path ticker is a simple US symbol.
 * Roic docs often use "AAPL US", but some names only resolve as bare "HTZ" or "HTZ:US".
 */
export function getRoicSymbolCandidates(ticker: string, requestOverride?: string | null): string[] {
  const env = process.env.ROIC_AI_SYMBOL_OVERRIDE?.trim();
  if (env) return [sanitizeRoicSymbolForRql(env)];

  const o = requestOverride?.trim();
  if (o) return [sanitizeRoicSymbolForRql(o)];

  const raw = ticker.trim().toUpperCase().replace(/[^A-Z0-9.:\s-]/g, "").replace(/\s+/g, " ");
  if (!raw) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (s: string) => {
    const x = sanitizeRoicSymbolForRql(s);
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  if (/\s/.test(raw)) {
    add(raw);
    return out;
  }

  const withSpaceUs = formatTickerForRoic(raw);
  add(withSpaceUs);
  add(raw);
  add(`${raw}:US`);

  return out;
}

function probeSymbolQuery(roicSymbol: string): string {
  const sym = sanitizeRoicSymbolForRql(roicSymbol);
  return `get(eps) for('${sym}')`;
}

export type ResolveRoicSymbolResult =
  | { ok: true; symbol: string; tried: string[] }
  | { ok: false; tried: string[]; error: string };

/** Picks the first symbol candidate for which a lightweight `get(eps)` probe succeeds (HTTP OK and no embedded API error). */
export async function resolveRoicSymbolForTicker(
  ticker: string,
  apiKey: string,
  requestOverride?: string | null
): Promise<ResolveRoicSymbolResult> {
  const candidates = getRoicSymbolCandidates(ticker, requestOverride);
  if (candidates.length === 0) {
    return { ok: false, tried: [], error: "No symbol candidates to try." };
  }

  const tried: string[] = [];
  for (const cand of candidates) {
    tried.push(cand);
    const r = await roicRqlRequest(probeSymbolQuery(cand), apiKey);
    if (r.ok) return { ok: true, symbol: cand, tried };

    const err = (!r.ok ? r.error : "").toLowerCase();
    if (r.status === 401 || r.status === 403) {
      return { ok: false, tried, error: !r.ok ? r.error : "Forbidden" };
    }
    if (err.includes("api") && err.includes("key")) {
      return { ok: false, tried, error: !r.ok ? r.error : "API key error" };
    }
  }

  const hint =
    "Open the company on roic.ai and copy the exact quote symbol from the URL (e.g. …/quote/HTZ/…). " +
    "Paste it into “Roic symbol” in the app or set ROIC_AI_SYMBOL_OVERRIDE in .env.local.";
  return {
    ok: false,
    tried,
    error: `Invalid company symbol for all tried identifiers: ${tried.join(", ")}. ${hint}`,
  };
}

export function getRoicApiKey(): string | undefined {
  const k = process.env.ROIC_AI_API_KEY?.trim();
  return k || undefined;
}

/** Some Roic responses use HTTP 200 with `{ detail: { error } }` (same as the UI "Invalid company symbol"). */
export function roicResponseIndicatesError(data: unknown): string | null {
  if (data === null || typeof data !== "object") return null;
  const o = data as { detail?: unknown; error?: unknown };
  if (typeof o.error === "string" && o.error.trim()) return o.error.trim();
  const d = o.detail;
  if (d && typeof d === "object" && d !== null && "error" in d) {
    const e = (d as { error?: unknown }).error;
    if (typeof e === "string" && e.trim()) return e.trim();
  }
  return null;
}

export type RoicRqlResult =
  | { ok: true; data: unknown }
  | { ok: false; status: number; error: string; body?: string };

export async function roicRqlRequest(query: string, apiKey: string): Promise<RoicRqlResult> {
  const url = new URL(ROIC_RQL_URL);
  url.searchParams.set("query", query);
  url.searchParams.set("apikey", apiKey);

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { detail?: { error?: string }; error?: string };
        err = j.detail?.error ?? j.error ?? err;
      } catch {
        if (text.length > 0 && text.length < 400) err = text;
      }
      return { ok: false, status: res.status, error: err, body: text.slice(0, 2000) };
    }
    try {
      const data = JSON.parse(text) as unknown;
      const embedded = roicResponseIndicatesError(data);
      if (embedded) {
        return { ok: false, status: res.status, error: embedded, body: text.slice(0, 2000) };
      }
      return { ok: true, data };
    } catch {
      return { ok: true, data: text };
    }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Request failed" };
  }
}

/** Default annual fields (IDs from Roic knowledge base). Override with ROIC_AI_ANNUAL_FIELDS=comma,separated */
export function getDefaultAnnualFieldIds(): string[] {
  const env = process.env.ROIC_AI_ANNUAL_FIELDS?.trim();
  if (env) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  // IDs must match https://www.roic.ai/knowledge-base/financial-definitions/ (not generic GAAP names).
  return [
    "is_sales_revenue_turnover",
    "eps",
    "is_oper_income",
    "is_net_income",
    "bs_tot_asset",
    "bs_total_equity",
    "cf_cash_from_oper",
  ];
}

export function getDefaultQuarterlyFieldIds(): string[] {
  const env = process.env.ROIC_AI_QUARTERLY_FIELDS?.trim();
  if (env) {
    return env
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return getDefaultAnnualFieldIds();
}

export function buildAnnualRangeQuery(fieldId: string, roicSymbol: string, startYear: number, endYear: number): string {
  const sym = sanitizeRoicSymbolForRql(roicSymbol);
  const a = Math.min(startYear, endYear);
  const b = Math.max(startYear, endYear);
  return `get(${fieldId}(fa_period_type=A, fa_period_reference=range('${a}', '${b}'))) for('${sym}')`;
}

export function buildQuarterlyRangeQuery(fieldId: string, roicSymbol: string, fromPeriod: string, toPeriod: string): string {
  const sym = sanitizeRoicSymbolForRql(roicSymbol);
  return `get(${fieldId}(fa_period_type=Q, fa_period_reference=range('${fromPeriod}', '${toPeriod}'))) for('${sym}')`;
}

/** Earnings transcript field ID from knowledge base; try ROIC_AI_EARNINGS_TRANSCRIPT_FIELD or a short list of guesses. */
export function getEarningsTranscriptFieldId(): string {
  return (
    process.env.ROIC_AI_EARNINGS_TRANSCRIPT_FIELD?.trim() ||
    process.env.ROIC_EARNINGS_TRANSCRIPT_FIELD?.trim() ||
    "earnings_call_transcript"
  );
}

export function buildTranscriptQuery(fieldId: string, roicSymbol: string, period: string): string {
  const sym = sanitizeRoicSymbolForRql(roicSymbol);
  const p = period.replace(/\s/g, "").toUpperCase();
  return `get(${fieldId}(fa_period_type=Q, fa_period_reference='${p}')) for('${sym}')`;
}

/** Parse Roic-style quarter codes (e.g. 2026Q2) for the v2 earnings-calls API. */
export function parseRoicQuarterPeriod(period: string): { year: number; quarter: number } | null {
  const m = /^(\d{4})Q([1-4])$/i.exec(period.replace(/\s/g, ""));
  if (!m) return null;
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

/** Identifiers to try with the v2 earnings-calls transcript endpoint (ticker, CIK, etc.). */
export function getRoicTranscriptIdentifierCandidates(
  ticker: string,
  requestOverride?: string | null
): string[] {
  const env = process.env.ROIC_AI_SYMBOL_OVERRIDE?.trim();
  if (env) return [env];

  const o = requestOverride?.trim();
  if (o) return [o];

  const raw = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return raw ? [raw] : [];
}

export type RoicV2EarningsTranscriptResult =
  | { ok: true; content: string; symbol: string; year: number; quarter: number; date?: string }
  | { ok: false; status: number; error: string };

/** Fetch a single earnings call transcript via Roic REST v2 (not RQL). */
export async function fetchRoicV2EarningsCallTranscript(
  identifier: string,
  year: number,
  quarter: number
): Promise<RoicV2EarningsTranscriptResult> {
  const apiKey = getRoicApiKey();
  if (!apiKey) {
    return { ok: false, status: 503, error: "ROIC_AI_API_KEY is not configured." };
  }

  const id = identifier.trim();
  if (!id) return { ok: false, status: 400, error: "Missing company identifier." };
  if (!Number.isFinite(year) || year < 1990 || year > 2100) {
    return { ok: false, status: 400, error: `Invalid fiscal year: ${year}` };
  }
  if (![1, 2, 3, 4].includes(quarter)) {
    return { ok: false, status: 400, error: `Invalid fiscal quarter: ${quarter}` };
  }

  const url = new URL(
    `https://api.roic.ai/v2/company/earnings-calls/transcript/${encodeURIComponent(id)}`
  );
  url.searchParams.set("apikey", apiKey);
  url.searchParams.set("year", String(year));
  url.searchParams.set("quarter", String(quarter));

  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as {
          detail?: { error?: string };
          error?: string;
          message?: string;
        };
        err = j.detail?.error ?? j.error ?? j.message ?? err;
      } catch {
        if (text.length > 0 && text.length < 400) err = text;
      }
      return { ok: false, status: res.status, error: err };
    }

    let data: { content?: unknown; symbol?: unknown; year?: unknown; quarter?: unknown; date?: unknown };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      return { ok: false, status: 502, error: "Invalid JSON from Roic v2 earnings-calls API." };
    }

    const content = typeof data.content === "string" ? data.content.trim() : "";
    if (content.length < 200) {
      return {
        ok: false,
        status: 404,
        error: `No transcript text returned for ${year} Q${quarter}.`,
      };
    }

    return {
      ok: true,
      content,
      symbol: typeof data.symbol === "string" && data.symbol.trim() ? data.symbol.trim() : id,
      year: typeof data.year === "number" ? data.year : year,
      quarter: typeof data.quarter === "number" ? data.quarter : quarter,
      date: typeof data.date === "string" ? data.date : undefined,
    };
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Request failed" };
  }
}
