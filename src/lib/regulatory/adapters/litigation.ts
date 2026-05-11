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

function buildNameVariants(params: RegulatorySearchParams): string[] {
  const raw = [params.query, params.companyName, ...(params.entityNames ?? [])]
    .map((value) => normalizePhrase(String(value ?? "")))
    .filter(Boolean);
  const suffixPattern =
    /\b(incorporated|inc|corp(?:oration)?|company|co|holdings?|group|llc|l\.l\.c\.|ltd|limited|plc|lp|l\.p\.|na|n\.a\.)\b/gi;
  const variants = new Set<string>();
  for (const item of raw) {
    variants.add(item);
    const noSuffix = normalizePhrase(item.replace(/[.,]/g, " ").replace(suffixPattern, " "));
    if (noSuffix && noSuffix.length >= 4) variants.add(noSuffix);
  }
  return [...variants].slice(0, 3);
}

function stripHtml(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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

function buildCourtListenerQuery(variants: string[]): string {
  if (!variants.length) return "";
  return variants.map((variant) => `"${variant.replace(/"/g, '\\"')}"`).join(" OR ");
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
  url.searchParams.set("highlight", "on");

  const res = await fetch(url.toString(), {
    cache: "no-store",
    headers: {
      Authorization: `Token ${token}`,
      Accept: "application/json",
    },
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false as const,
      warning: `CourtListener search failed (HTTP ${res.status}).`,
      requestUrl: url.toString(),
      raw,
    };
  }
  const rows = (((raw as { results?: unknown[] } | null)?.results ?? []) as CourtListenerSearchRow[]);
  return { ok: true as const, requestUrl: url.toString(), raw, rows };
}

async function fetchPacerToken() {
  const username = pacerUsername();
  const password = pacerPassword();
  if (!username || !password) return null;

  const res = await fetch("https://pacer.login.uscourts.gov/services/cso-auth", {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      loginId: username,
      password,
      clientCode: pacerClientCode() || undefined,
      otp: pacerOtp() || undefined,
    }),
  });
  const raw = await res.json().catch(() => null);
  const token = String((raw as Record<string, unknown> | null)?.nextGenCSO ?? "").trim();
  if (!res.ok || !token) {
    return {
      ok: false as const,
      warning:
        String((raw as Record<string, unknown> | null)?.error ?? "").trim() ||
        `PACER authentication failed (HTTP ${res.status}).`,
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
  const searchName = variants[0];
  if (!searchName) {
    return { ok: false as const, warning: "PACER search skipped because no usable litigation query was available." };
  }

  const auth = await fetchPacerToken();
  if (!auth || !auth.ok) {
    return {
      ok: false as const,
      warning: auth?.warning ?? "PACER authentication failed.",
      raw: auth?.raw,
    };
  }

  const url = new URL("https://pcl.uscourts.gov/pcl-public-api/rest/parties/find?page=0");
  const body: Record<string, unknown> = {
    lastName: searchName,
    exactNameMatch: false,
  };
  if (params.startDate || params.endDate) {
    body.courtCase = {
      dateFiledFrom: params.startDate || undefined,
      dateFiledTo: params.endDate || undefined,
    };
  }

  const res = await fetch(url.toString(), {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-NEXT-GEN-CSO": auth.token,
    },
    body: JSON.stringify(body),
  });
  const raw = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      ok: false as const,
      warning: `PACER party search failed (HTTP ${res.status}).`,
      requestUrl: url.toString(),
      raw,
    };
  }
  const rows = (((raw as { content?: unknown[] } | null)?.content ?? []) as PacerPartyRow[]);
  return { ok: true as const, requestUrl: url.toString(), raw, rows };
}

export const litigationAdapter: RegulatoryAgencyAdapter = {
  sourceId: "litigation",
  validateConfig: () => {
    const hasCourtListener = Boolean(courtListenerToken());
    const hasPacer = Boolean(pacerUsername() && pacerPassword());
    if (hasCourtListener || hasPacer) {
      return {
        ok: true,
        mode: "api_key",
        message:
          hasCourtListener && hasPacer
            ? "Using CourtListener / RECAP and PACER Case Locator."
            : hasCourtListener
              ? "Using CourtListener / RECAP. PACER Case Locator is optional if PACER credentials are added."
              : "Using PACER Case Locator only. CourtListener / RECAP is optional if COURTLISTENER_API_TOKEN is added.",
      };
    }
    return {
      ok: false,
      mode: "missing_key",
      message:
        "Set COURTLISTENER_API_TOKEN for CourtListener / RECAP search. Optionally add PACER_USERNAME and PACER_PASSWORD for PACER Case Locator coverage.",
      envKeyName: "COURTLISTENER_API_TOKEN",
    };
  },
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const [courtListener, pacer] = await Promise.all([searchCourtListener(params), searchPacer(params)]);
    const retrievedAt = new Date().toISOString();
    const warnings: string[] = [];
    const results: RegulatorySearchResult[] = [];

    if (!courtListener.ok && courtListener.warning) warnings.push(courtListener.warning);
    if (!pacer.ok && pacer.warning) warnings.push(pacer.warning);

    if (courtListener.ok) {
      for (const row of courtListener.rows) {
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

    if (pacer.ok) {
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

    results.sort((a, b) => {
      const rank = (value: string) => (value === "High" ? 2 : value === "Medium" ? 1 : 0);
      const diff = rank(b.confidence) - rank(a.confidence);
      if (diff !== 0) return diff;
      return String(b.filing_or_record_date ?? "").localeCompare(String(a.filing_or_record_date ?? ""));
    });

    if (results.length === 0) {
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

    if (courtListener.ok) {
      warnings.push("CourtListener / RECAP coverage is strongest where PACER data has been collected into RECAP; it is not a complete substitute for PACER.");
    }

    return {
      ok: true,
      requestUrl: courtListener.ok ? courtListener.requestUrl : pacer.ok ? pacer.requestUrl : undefined,
      raw: { courtListener: courtListener.ok ? courtListener.raw : null, pacer: pacer.ok ? pacer.raw : null },
      results: results.slice(0, 50),
      warnings: warnings.length ? [...new Set(warnings)] : undefined,
    };
  },
};
