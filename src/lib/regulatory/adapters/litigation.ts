import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type CourtListenerSearchRow = {
  absolute_url?: string | null;
  docketAbsoluteUrl?: string | null;
  docket_absolute_url?: string | null;
  caseName?: string | null;
  caseNameFull?: string | null;
  court?: string | null;
  court_id?: string | null;
  dateFiled?: string | null;
  docketNumber?: string | null;
  docket_id?: string | number | null;
  suitNature?: string | null;
  snippet?: string | null;
  status?: string | null;
};

type PacerPartyRow = {
  courtId?: string | null;
  caseId?: number | string | null;
  lastName?: string | null;
  firstName?: string | null;
  caseTitle?: string | null;
  caseNumberFull?: string | null;
  dateFiled?: string | null;
  effectiveDateClosed?: string | null;
  natureOfSuit?: string | null;
  caseLink?: string | null;
  courtCase?: {
    courtId?: string | null;
    caseId?: number | string | null;
    caseTitle?: string | null;
    caseNumberFull?: string | null;
    caseLink?: string | null;
    dateFiled?: string | null;
    effectiveDateClosed?: string | null;
    natureOfSuit?: string | null;
    jurisdictionType?: string | null;
  } | null;
};

type CourtListenerSearchResponse = {
  count?: number | null;
  next?: string | null;
  previous?: string | null;
  results?: CourtListenerSearchRow[];
};

type PacerSearchResponse = {
  content?: PacerPartyRow[];
  pageInfo?: {
    number?: number | null;
    size?: number | null;
    totalPages?: number | null;
    totalElements?: number | null;
  } | null;
  size?: number | null;
  recordCount?: number | null;
  unbilledPageCount?: number | null;
};

/** Set true to re-enable PACER Case Locator party search (may incur PACER charges). */
const LITIGATION_PACER_ENABLED = false;

const COURTLISTENER_PAGE_SIZE = 50;
const COURTLISTENER_MAX_PAGES = 100;
const PACER_PAGE_SIZE = 54;
const PACER_MAX_PAGES = 100;
const COURTLISTENER_MAX_429_RETRIES = 1;
const COURTLISTENER_MAX_ELAPSED_MS = 15_000;
const PACER_MAX_ELAPSED_MS = 15_000;
const COURTLISTENER_FETCH_TIMEOUT_MS = 10_000;
const PACER_FETCH_TIMEOUT_MS = 10_000;

function rid() {
  return `lit_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function courtListenerToken(): string | undefined {
  return process.env.COURTLISTENER_API_TOKEN?.trim();
}

function pacerUsername(): string | undefined {
  return process.env.PACER_USERNAME?.trim();
}

function pacerPassword(): string | undefined {
  return process.env.PACER_PASSWORD?.trim();
}

function pacerClientCode(): string | undefined {
  return process.env.PACER_CLIENT_CODE?.trim();
}

function pacerOtp(): string | undefined {
  return process.env.PACER_OTP?.trim();
}

function normalizePhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const CORPORATE_SUFFIX_PATTERN =
  /\b(incorporated|inc|corp(?:oration)?|company|co|holdings?|group|llc|l\.l\.c\.|ltd|limited|plc|lp|l\.p\.|na|n\.a\.)\b/gi;

function buildNameVariants(params: RegulatorySearchParams): string[] {
  const raw = [params.query, params.companyName, ...(params.entityNames ?? [])]
    .map((value) => normalizePhrase(String(value ?? "")))
    .filter(Boolean);
  const variants = new Set<string>();
  for (const item of raw) {
    variants.add(item);
    const noSuffix = normalizePhrase(item.replace(/[.,]/g, " ").replace(CORPORATE_SUFFIX_PATTERN, " "));
    if (noSuffix && noSuffix.length >= 4) variants.add(noSuffix);
    const commaHead = normalizePhrase(item.split(",")[0] ?? "");
    if (commaHead && commaHead.length >= 4) variants.add(commaHead);
  }
  return [...variants].slice(0, 12);
}

function stripHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeEntityMatchText(value: string): string {
  return normalizePhrase(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function entityTokens(value: string): string[] {
  return normalizeEntityMatchText(value)
    .split(" ")
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function buildCaptionMatchVariants(params: RegulatorySearchParams): string[] {
  return buildNameVariants(params)
    .map((variant) => normalizePhrase(variant))
    .filter((variant) => variant.length >= 4)
    .sort((a, b) => b.length - a.length);
}

function captionContainsEntity(caption: string, variants: string[]): boolean {
  const normalizedCaption = normalizeEntityMatchText(caption);
  if (!normalizedCaption) return false;

  for (const variant of variants) {
    const normalizedVariant = normalizeEntityMatchText(variant);
    if (!normalizedVariant) continue;
    if (normalizedCaption.includes(normalizedVariant)) return true;

    const tokens = entityTokens(variant);
    if (tokens.length >= 2 && tokens.every((token) => normalizedCaption.includes(token))) {
      return true;
    }
  }
  return false;
}

export function courtListenerRowMatchesEntity(row: CourtListenerSearchRow, params: RegulatorySearchParams): boolean {
  const variants = buildCaptionMatchVariants(params);
  if (!variants.length) return true;

  const title = String(row.caseNameFull ?? row.caseName ?? "").trim();
  if (!title) return false;
  return captionContainsEntity(title, variants);
}

function asCourtListenerCaseUrl(row: CourtListenerSearchRow): string {
  const explicit =
    String(row.docketAbsoluteUrl ?? row.docket_absolute_url ?? row.absolute_url ?? "").trim();
  if (explicit) {
    return explicit.startsWith("http") ? explicit : `https://www.courtlistener.com${explicit}`;
  }
  const docketId = String(row.docket_id ?? "").trim();
  if (docketId) {
    return `https://www.courtlistener.com/docket/${encodeURIComponent(docketId)}/`;
  }
  return "https://www.courtlistener.com/search/";
}

function scoreCourtListenerVariant(variant: string): number {
  const trimmed = normalizePhrase(variant);
  if (!trimmed) return Number.NEGATIVE_INFINITY;

  const alphaWords = trimmed
    .split(/\s+/)
    .map((word) => word.replace(/[^A-Za-z]/g, ""))
    .filter(Boolean);
  const lettersOnly = trimmed.replace(/[^A-Za-z]/g, "");
  const hasCorporateSuffix = CORPORATE_SUFFIX_PATTERN.test(trimmed);
  CORPORATE_SUFFIX_PATTERN.lastIndex = 0;

  let score = 0;
  if (alphaWords.length >= 2) score += 6;
  if (alphaWords.length >= 3) score += 1;
  if (!hasCorporateSuffix) score += 4;
  if (!/[.,;:]/.test(trimmed)) score += 2;
  if (lettersOnly.length >= 8) score += 1;
  if (alphaWords.length === 1) score -= 3;
  if (lettersOnly.length <= 5 && /^[A-Z0-9.&-]+$/.test(trimmed)) score -= 5;
  score -= trimmed.length * 0.01;
  return score;
}

export function buildCourtListenerQuery(variants: string[]): string {
  if (!variants.length) return "";
  const normalized = [...new Set(variants.map((variant) => normalizePhrase(variant)).filter(Boolean))];
  if (!normalized.length) return "";

  const selected =
    normalized
      .map((variant) => ({ variant, score: scoreCourtListenerVariant(variant) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.variant.length - b.variant.length;
      })[0]?.variant ?? normalized[0];

  return selected.replace(/"/g, '\\"');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(input: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function retryAfterMs(headerValue: string | null, attempt: number): number {
  const seconds = Number.parseInt(String(headerValue ?? "").trim(), 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, 30_000);
  }
  return Math.min(1000 * 2 ** attempt, 8000);
}

function normalizeStateFilter(state: string | undefined): string | null {
  const normalized = String(state ?? "").trim().toLowerCase();
  return /^[a-z]{2}$/.test(normalized) ? normalized : null;
}

function courtIdMatchesState(courtId: string | null | undefined, stateFilter: string | null): boolean {
  if (!stateFilter) return true;
  const normalizedCourtId = String(courtId ?? "").trim().toLowerCase();
  if (!normalizedCourtId) return true;
  return normalizedCourtId.startsWith(stateFilter);
}

function dedupeLitigationResults(rows: RegulatorySearchResult[]): RegulatorySearchResult[] {
  const seen = new Set<string>();
  const out: RegulatorySearchResult[] = [];
  for (const row of rows) {
    const key = [
      row.agency,
      row.agency_identifier ?? "",
      row.docket_number ?? "",
      row.detail_url ?? "",
      row.title ?? "",
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function summarizePacerWarning(warning: string): string {
  const text = String(warning ?? "").replace(/\s+/g, " ").trim();
  if (!text) return text;
  if (/activate case search privileges|will not be able to search/i.test(text)) {
    return "PACER account authenticated, but PACER case-search privileges are not active for this account.";
  }
  return text;
}

function formatCourtListener429Warning(retryAfterHeader: string | null | undefined): string {
  const base =
    "CourtListener is rate-limiting this search right now (HTTP 429). This token appears to be limited to about 50 requests/hour.";
  const seconds = Number.parseInt(String(retryAfterHeader ?? "").trim(), 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    const minutes = Math.ceil(seconds / 60);
    return `${base} CourtListener asked us to wait about ${minutes} minute(s) before retrying.`;
  }
  return base;
}

async function searchCourtListener(params: RegulatorySearchParams) {
  const token = courtListenerToken();
  if (!token) {
    return { ok: false as const, warning: "CourtListener not configured: set COURTLISTENER_API_TOKEN to enable RECAP litigation search." };
  }
  const variants = buildNameVariants(params);
  const q = buildCourtListenerQuery(variants);
  if (!q) {
    return { ok: false as const, warning: "CourtListener search skipped because no usable litigation query was available." };
  }

  const url = new URL("https://www.courtlistener.com/api/rest/v4/search/");
  url.searchParams.set("q", q);
  url.searchParams.set("type", "r");
  url.searchParams.set("order_by", "dateFiled desc");
  url.searchParams.set("page_size", String(COURTLISTENER_PAGE_SIZE));

  const stateFilter = normalizeStateFilter(params.state);
  let nextUrl: string | null = url.toString();
  let pageCount = 0;
  let totalCount = 0;
  let firstRaw: CourtListenerSearchResponse | null = null;
  const rows: CourtListenerSearchRow[] = [];
  const warnings: string[] = [];
  let retryCount429 = 0;
  const startedAt = Date.now();
  const seenPageUrls = new Set<string>();

  while (nextUrl && pageCount < COURTLISTENER_MAX_PAGES) {
    if (Date.now() - startedAt > COURTLISTENER_MAX_ELAPSED_MS) {
      warnings.push(
        `CourtListener search hit the ${Math.round(COURTLISTENER_MAX_ELAPSED_MS / 1000)}s time budget; showing ${rows.length} RECAP result(s) retrieved so far.`
      );
      break;
    }
    if (seenPageUrls.has(nextUrl)) {
      warnings.push("CourtListener pagination returned a repeated cursor; stopping early to avoid a request loop.");
      break;
    }
    seenPageUrls.add(nextUrl);
    let res: Response;
    try {
      res = await fetchWithTimeout(
        nextUrl,
        {
          cache: "no-store",
          headers: {
            Authorization: `Token ${token}`,
            Accept: "application/json",
          },
        },
        COURTLISTENER_FETCH_TIMEOUT_MS
      );
    } catch (error) {
      if (rows.length > 0) {
        warnings.push(
          `CourtListener timed out after ${Math.round(COURTLISTENER_FETCH_TIMEOUT_MS / 1000)}s on page ${pageCount + 1}; showing ${rows.length} RECAP result(s) retrieved before timeout.`
        );
        break;
      }
      return {
        ok: false as const,
        warning: error instanceof Error ? error.message : "CourtListener request timed out.",
        requestUrl: nextUrl,
      };
    }
    const raw = (await res.json().catch(() => null)) as CourtListenerSearchResponse | null;
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get("retry-after");
      const waitMs = retryAfterMs(retryAfterHeader, retryCount429);
      const remainingBudgetMs = COURTLISTENER_MAX_ELAPSED_MS - (Date.now() - startedAt);
      const canRetry =
        rows.length > 0 &&
        retryCount429 < COURTLISTENER_MAX_429_RETRIES &&
        waitMs < Math.max(remainingBudgetMs - 1000, 0);
      if (canRetry) {
        retryCount429 += 1;
        await sleep(waitMs);
        continue;
      }
      if (rows.length > 0) {
        warnings.push(
          `CourtListener rate-limited after ${pageCount} page(s); showing ${rows.length} RECAP result(s) retrieved before throttling. ${formatCourtListener429Warning(
            retryAfterHeader
          )}`
        );
        break;
      }
      return {
        ok: false as const,
        warning: formatCourtListener429Warning(retryAfterHeader),
        requestUrl: nextUrl,
        raw,
      };
    }
    if (!res.ok) {
      if (rows.length > 0) {
        warnings.push(
          `CourtListener stopped on page ${pageCount + 1} with HTTP ${res.status}; showing ${rows.length} RECAP result(s) retrieved before the error.`
        );
        break;
      }
      return {
        ok: false as const,
        warning: `CourtListener search failed (HTTP ${res.status}).`,
        requestUrl: nextUrl,
        raw,
      };
    }
    retryCount429 = 0;
    if (!firstRaw) firstRaw = raw;
    totalCount = Number(raw?.count ?? totalCount);
    const pageRows = (raw?.results ?? []).filter((row) => courtIdMatchesState(row.court_id, stateFilter));
    rows.push(...pageRows);
    nextUrl = typeof raw?.next === "string" && raw.next.trim() ? raw.next : null;
    pageCount += 1;
  }

  if (nextUrl && pageCount >= COURTLISTENER_MAX_PAGES) {
    warnings.push(
      `CourtListener returned more than ${COURTLISTENER_MAX_PAGES} page(s); results were truncated at the configured maximum.`
    );
  }

  return {
    ok: true as const,
    requestUrl: url.toString(),
    raw: { count: totalCount, pagesFetched: pageCount, next: nextUrl, firstPage: firstRaw },
    rows,
    warnings: warnings.length ? warnings : undefined,
  };
}

async function fetchPacerToken() {
  const username = pacerUsername();
  const password = pacerPassword();
  if (!username || !password) return null;

  const res = await fetchWithTimeout(
    "https://pacer.login.uscourts.gov/services/cso-auth",
    {
      method: "POST",
      cache: "no-store",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": "CenturyEggCredit research app (mailto:support@example.com)",
      },
      body: JSON.stringify({
        loginId: username,
        password,
        clientCode: pacerClientCode() || undefined,
        otp: pacerOtp() || undefined,
      }),
    },
    PACER_FETCH_TIMEOUT_MS
  );
  const raw = await res.json().catch(() => null);
  const token = String((raw as Record<string, unknown> | null)?.nextGenCSO ?? "").trim();
  const errorDescription = String((raw as Record<string, unknown> | null)?.errorDescription ?? "").trim();
  if (!res.ok || !token) {
    return {
      ok: false as const,
      warning:
        String((raw as Record<string, unknown> | null)?.error ?? "").trim() ||
        errorDescription ||
        `PACER authentication failed (HTTP ${res.status}).`,
      raw,
    };
  }
  if (/activate case search privileges|will not be able to search/i.test(errorDescription)) {
    return {
      ok: false as const,
      warning: errorDescription,
      raw,
    };
  }
  return { ok: true as const, token, raw };
}

async function searchPacer(params: RegulatorySearchParams) {
  const username = pacerUsername();
  const password = pacerPassword();
  if (!username || !password) {
    return {
      ok: false as const,
      warning: "PACER search not configured: set PACER_USERNAME and PACER_PASSWORD to enable PACER Case Locator party search.",
    };
  }
  const variants = buildNameVariants(params);
  if (!variants.length) {
    return { ok: false as const, warning: "PACER search skipped because no usable litigation query was available." };
  }

  let auth = await fetchPacerToken();
  if (!auth || !auth.ok) {
    return {
      ok: false as const,
      warning: auth?.warning ?? "PACER authentication failed.",
      raw: auth?.raw,
    };
  }
  const stateFilter = normalizeStateFilter(params.state);
  const rows: PacerPartyRow[] = [];
  const warnings: string[] = [];
  let firstRequestUrl: string | undefined;
  let firstRaw: PacerSearchResponse | null = null;
  let totalElements = 0;
  let totalPages = 0;
  const startedAt = Date.now();

  for (const searchName of variants) {
    let page = 0;
    while (page < PACER_MAX_PAGES) {
      if (Date.now() - startedAt > PACER_MAX_ELAPSED_MS) {
        warnings.push(
          `PACER search hit the ${Math.round(PACER_MAX_ELAPSED_MS / 1000)}s time budget; showing ${rows.length} PACER result(s) retrieved so far.`
        );
        return {
          ok: true as const,
          requestUrl: firstRequestUrl,
          raw: { totalElements, totalPages, firstPage: firstRaw, warnings },
          rows,
          warnings,
        };
      }
      const url = new URL(`https://pcl.uscourts.gov/pcl-public-api/rest/parties/find?page=${page}`);
      if (!firstRequestUrl) firstRequestUrl = url.toString();
      const body: Record<string, unknown> = {
        lastName: searchName,
        exactNameMatch: false,
      };
      if (stateFilter) {
        body.courtId = [stateFilter];
      }
      if (params.startDate || params.endDate) {
        body.courtCase = {
          dateFiledFrom: params.startDate || undefined,
          dateFiledTo: params.endDate || undefined,
        };
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(
          url.toString(),
          {
            method: "POST",
            cache: "no-store",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
              "X-NEXT-GEN-CSO": auth.token,
              "User-Agent": "CenturyEggCredit research app (mailto:support@example.com)",
            },
            body: JSON.stringify(body),
          },
          PACER_FETCH_TIMEOUT_MS
        );
      } catch (error) {
        if (rows.length > 0) {
          warnings.push(
            `PACER request timed out after ${Math.round(PACER_FETCH_TIMEOUT_MS / 1000)}s; showing ${rows.length} PACER result(s) retrieved before timeout.`
          );
          return {
            ok: true as const,
            requestUrl: firstRequestUrl,
            raw: { totalElements, totalPages, firstPage: firstRaw, warnings },
            rows,
            warnings,
          };
        }
        return {
          ok: false as const,
          warning: error instanceof Error ? error.message : "PACER request timed out.",
          requestUrl: url.toString(),
        };
      }
      let raw = (await res.json().catch(() => null)) as PacerSearchResponse | { status?: number; message?: string } | null;

      if (res.status === 401) {
        const refreshed = await fetchPacerToken();
        if (!refreshed || !refreshed.ok) {
          return {
            ok: false as const,
            warning: refreshed?.warning ?? "PACER authentication failed.",
            requestUrl: url.toString(),
            raw: refreshed?.raw ?? raw,
          };
        }
        auth = refreshed;
        try {
          res = await fetchWithTimeout(
            url.toString(),
            {
              method: "POST",
              cache: "no-store",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                "X-NEXT-GEN-CSO": auth.token,
                "User-Agent": "CenturyEggCredit research app (mailto:support@example.com)",
              },
              body: JSON.stringify(body),
            },
            PACER_FETCH_TIMEOUT_MS
          );
        } catch (error) {
          return {
            ok: false as const,
            warning: error instanceof Error ? error.message : "PACER request timed out after token refresh.",
            requestUrl: url.toString(),
          };
        }
        raw = (await res.json().catch(() => null)) as PacerSearchResponse | { status?: number; message?: string } | null;
      }

      if (!res.ok) {
        return {
          ok: false as const,
          warning:
            String((raw as { message?: string } | null)?.message ?? "").trim() ||
            `PACER party search failed (HTTP ${res.status}).`,
          requestUrl: url.toString(),
          raw,
        };
      }

      const pagePayload = raw as PacerSearchResponse | null;
      if (!firstRaw) firstRaw = pagePayload;
      const pageRows = (pagePayload?.content ?? []) as PacerPartyRow[];
      rows.push(...pageRows);

      const pageInfo = pagePayload?.pageInfo ?? {};
      totalPages = Math.max(totalPages, Number(pageInfo.totalPages ?? totalPages));
      totalElements = Math.max(
        totalElements,
        Number(pageInfo.totalElements ?? pagePayload?.recordCount ?? totalElements)
      );
      const currentPage = Number(pageInfo.number ?? page);
      const responseSize = Number(pageInfo.size ?? pagePayload?.size ?? PACER_PAGE_SIZE);
      const hasMoreByPageInfo = Number.isFinite(totalPages) && totalPages > currentPage + 1;
      const hasMoreByCount =
        Number.isFinite(totalElements) &&
        totalElements > 0 &&
        (currentPage + 1) * Math.max(responseSize, 1) < totalElements;
      if (!hasMoreByPageInfo && !hasMoreByCount) break;
      page += 1;
    }
  }

  if (totalPages > PACER_MAX_PAGES) {
    warnings.push(
      `PACER returned more than ${PACER_MAX_PAGES} page(s); results were truncated at the documented immediate-search limit.`
    );
  }

  return {
    ok: true as const,
    requestUrl: firstRequestUrl,
    raw: { totalElements, totalPages, firstPage: firstRaw, warnings },
    rows,
    warnings,
  };
}

export const litigationAdapter: RegulatoryAgencyAdapter = {
  sourceId: "litigation",
  validateConfig: () => {
    const hasCourtListener = Boolean(courtListenerToken());
    const hasPacer =
      LITIGATION_PACER_ENABLED && Boolean(pacerUsername() && pacerPassword());
    if (hasCourtListener || hasPacer) {
      return {
        ok: true,
        mode: "api_key",
        message:
          hasCourtListener && hasPacer
            ? "Using CourtListener / RECAP and PACER Case Locator."
            : hasCourtListener
              ? "Using CourtListener / RECAP for federal litigation search."
              : "Using PACER Case Locator only. CourtListener / RECAP is optional if COURTLISTENER_API_TOKEN is added.",
      };
    }
    return {
      ok: false,
      mode: "missing_key",
      message: "Set COURTLISTENER_API_TOKEN for CourtListener / RECAP litigation search.",
      envKeyName: "COURTLISTENER_API_TOKEN",
    };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const courtListener = await searchCourtListener(params);
    const pacer = LITIGATION_PACER_ENABLED
      ? await searchPacer(params)
      : { ok: false as const, warning: undefined, warnings: [] as string[], rows: [] as PacerPartyRow[], requestUrl: undefined, raw: null };
    const retrievedAt = new Date().toISOString();
    const warnings: string[] = [];
    const results: RegulatorySearchResult[] = [];

    if (!courtListener.ok && courtListener.warning) warnings.push(courtListener.warning);
    if (courtListener.ok && courtListener.warnings?.length) warnings.push(...courtListener.warnings);
    if (LITIGATION_PACER_ENABLED) {
      if (!pacer.ok && pacer.warning) warnings.push(summarizePacerWarning(pacer.warning));
      if (pacer.ok && pacer.warnings?.length) warnings.push(...pacer.warnings);
    }

    if (courtListener.ok) {
      for (const row of courtListener.rows) {
        if (!courtListenerRowMatchesEntity(row, params)) continue;
        const title = String(row.caseNameFull ?? row.caseName ?? "").trim() || "Federal litigation docket";
        const detailUrl = asCourtListenerCaseUrl(row);
        const docketNumber = String(row.docketNumber ?? "").trim();
        const court = String(row.court ?? row.court_id ?? "").trim();
        const confidence = matchConfidenceFromQuery(q, [title, docketNumber, court, stripHtml(row.snippet)]);
        results.push({
          result_id: rid(),
          source_id: "litigation",
          source_name: "Litigation",
          agency: "CourtListener / RECAP",
          category: "Federal Litigation / Dockets / RECAP",
          query_used: q,
          matched_entity: params.companyName?.trim() || q,
          matched_entity_confidence: confidence,
          title,
          record_type: "docket",
          record_subtype: "CourtListener / RECAP",
          description: [court ? `Court: ${court}` : "", row.suitNature ? `Nature of suit: ${String(row.suitNature).trim()}` : ""].filter(Boolean).join(" · ") || undefined,
          filing_or_record_date: String(row.dateFiled ?? "").trim() || undefined,
          docket_number: docketNumber || undefined,
          agency_identifier: String(row.docket_id ?? "").trim() || undefined,
          state: normalizeStateFilter(params.state)?.toUpperCase() || undefined,
          detail_url: detailUrl,
          document_url: detailUrl,
          source_quote: stripHtml(row.snippet) || undefined,
          raw_json: row,
          confidence,
          importance_score: confidence === "High" ? 80 : confidence === "Medium" ? 55 : 25,
          notes: row.status ? `Status: ${String(row.status).trim()}` : undefined,
          retrieved_at: retrievedAt,
          request_url: courtListener.requestUrl,
        });
      }
    }

    if (LITIGATION_PACER_ENABLED && pacer.ok) {
      const pageInfo = (pacer.raw as { pageInfo?: Record<string, unknown> } | null)?.pageInfo ?? {};
      const totalPages = Number(pageInfo.totalPages ?? 0);
      const totalElements = Number(pageInfo.totalElements ?? 0);
      if (totalPages > 1 || totalElements > pacer.rows.length) {
        warnings.push(
          `PACER Case Locator returned ${totalElements || "multiple"} matches across ${totalPages || "multiple"} page(s); this tab only retrieves the first page to avoid unexpected PACER search charges.`
        );
      }

      for (const row of pacer.rows) {
        const caseRow = row.courtCase ?? {};
        const title = String(caseRow.caseTitle ?? row.caseTitle ?? "").trim() || "PACER case";
        const docketNumber = String(caseRow.caseNumberFull ?? row.caseNumberFull ?? "").trim();
        const court = String(caseRow.courtId ?? row.courtId ?? "").trim();
        const detailUrl = String(caseRow.caseLink ?? row.caseLink ?? "").trim() || "https://pcl.uscourts.gov/";
        const dateFiled = String(caseRow.dateFiled ?? row.dateFiled ?? "").trim();
        const dateClosed = String(caseRow.effectiveDateClosed ?? row.effectiveDateClosed ?? "").trim();
        const natureOfSuit = String(caseRow.natureOfSuit ?? row.natureOfSuit ?? "").trim();
        const matchedParty = [String(row.firstName ?? "").trim(), String(row.lastName ?? "").trim()].filter(Boolean).join(" ");
        const confidence = matchConfidenceFromQuery(q, [title, matchedParty, docketNumber, court]);
        results.push({
          result_id: rid(),
          source_id: "litigation",
          source_name: "Litigation",
          agency: "PACER Case Locator",
          category: "Federal Litigation / PACER",
          query_used: q,
          matched_entity: matchedParty || params.companyName?.trim() || q,
          matched_entity_confidence: confidence,
          title,
          record_type: "case",
          record_subtype: "PACER party search",
          description: [court ? `Court: ${court}` : "", natureOfSuit ? `Nature of suit: ${natureOfSuit}` : ""].filter(Boolean).join(" · ") || undefined,
          filing_or_record_date: dateFiled || undefined,
          last_updated: dateClosed || undefined,
          status: dateClosed ? "Closed" : "Open / pending",
          state: normalizeStateFilter(params.state)?.toUpperCase() || undefined,
          docket_number: docketNumber || undefined,
          agency_identifier: String(caseRow.caseId ?? row.caseId ?? "").trim() || undefined,
          detail_url: detailUrl,
          document_url: detailUrl,
          raw_json: row,
          confidence,
          importance_score: confidence === "High" ? 85 : confidence === "Medium" ? 60 : 30,
          notes: "PACER search may incur charges outside this app; refine the query and continue on PACER for exhaustive review.",
          retrieved_at: retrievedAt,
          request_url: pacer.requestUrl,
        });
      }
    }

    const deduped = dedupeLitigationResults(results);
    deduped.sort((a, b) => {
      const rank = (value: string) => (value === "High" ? 2 : value === "Medium" ? 1 : 0);
      const diff = rank(b.confidence) - rank(a.confidence);
      if (diff !== 0) return diff;
      return String(b.filing_or_record_date ?? "").localeCompare(String(a.filing_or_record_date ?? ""));
    });

    if (deduped.length === 0) {
      return {
        ok: true,
        requestUrl: courtListener.ok ? courtListener.requestUrl : pacer.ok ? pacer.requestUrl : undefined,
        raw: { courtListener: courtListener.ok ? courtListener.raw : null, pacer: pacer.ok ? pacer.raw : null },
        results: [],
        warnings: warnings.length
          ? warnings
          : ["No litigation matches were returned. Try a different legal-entity name, affiliate name, or narrower company variant."],
      };
    }

    return {
      ok: true,
      requestUrl: courtListener.ok ? courtListener.requestUrl : pacer.ok ? pacer.requestUrl : undefined,
      raw: { courtListener: courtListener.ok ? courtListener.raw : null, pacer: pacer.ok ? pacer.raw : null },
      results: deduped,
      warnings: warnings.length ? [...new Set(warnings)] : undefined,
    };
  },
};
