import * as cheerio from "cheerio";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import { oshaAdapter } from "@/lib/regulatory/adapters/osha";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type DojPressReleaseRow = {
  uuid?: string | null;
  title?: string | null;
  url?: string | null;
  date?: string | number | null;
  body?: string | null;
};

type FtcCaseRow = {
  title: string;
  detailUrl: string;
  description?: string;
  actionType?: string;
  lastUpdated?: string;
  matterNumber?: string;
  docketNumber?: string;
  caseStatus?: string;
};

const DOJ_ENFORCEMENT_KEYWORDS =
  /\b(enforcement|settlement|settle|resolved|resolve|complaint|lawsuit|sued|sues|charged|charges|indicted|indictment|plea|pleads guilty|sentenced|penalty|fraud|antitrust|false claims|kickback|civil action|criminal action|consent decree)\b/i;

const FTC_BROWSER_HEADERS: HeadersInit = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  "user-agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
};

function rid() {
  return `enf_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripHtml(value: unknown): string {
  const html = String(value ?? "").trim();
  if (!html) return "";
  return clean(cheerio.load(`<div>${html}</div>`)("div").text());
}

function normalizePhrase(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

const ENFORCEMENT_QUERY_STOPWORDS = new Set([
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "llc",
  "ltd",
  "limited",
  "group",
  "holdings",
  "holding",
  "plc",
  "lp",
  "na",
  "the",
  "and",
]);

/** Significant tokens for enforcement relevance — drops generic corporate suffix words like "inc" / "group". */
export function significantEnforcementQueryTokens(query: string): string[] {
  return normalizePhrase(query)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 2 && !ENFORCEMENT_QUERY_STOPWORDS.has(word));
}

function tokenAppearsInText(token: string, text: string): boolean {
  if (!token || !text) return false;
  if (token.length <= 2) return text.toLowerCase().includes(token.toLowerCase());
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, "i").test(text);
}

/** Row must mention the user's query tokens (word-boundary), not just generic enforcement keywords. */
export function enforcementTextMatchesQuery(query: string, ...parts: (string | null | undefined)[]): boolean {
  const tokens = significantEnforcementQueryTokens(query);
  if (!tokens.length) {
    const fallback = normalizePhrase(query);
    return fallback.length >= 4 && tokenAppearsInText(fallback.toLowerCase(), parts.join(" "));
  }
  const combined = parts.map((part) => String(part ?? "")).join(" ");
  return tokens.every((token) => tokenAppearsInText(token, combined));
}

function enforcementApiQuery(params: RegulatorySearchParams): string {
  return clean(params.query);
}

function parseEpochDate(value: string | number | null | undefined): string | undefined {
  const raw = clean(value);
  if (!raw) return undefined;
  const asNumber = Number(raw);
  if (!Number.isFinite(asNumber) || asNumber <= 0) return raw;
  const date = new Date(asNumber * 1000);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toISOString().slice(0, 10);
}

function absoluteFtcUrl(href: string): string {
  const trimmed = clean(href);
  if (!trimmed) return "https://www.ftc.gov/legal-library/browse/cases-proceedings";
  return trimmed.startsWith("http") ? trimmed : `https://www.ftc.gov${trimmed}`;
}

function scoreImportance(confidence: "High" | "Medium" | "Low", strongSignal: boolean): number {
  if (strongSignal && confidence === "High") return 90;
  if (strongSignal && confidence === "Medium") return 78;
  if (confidence === "High") return 72;
  if (confidence === "Medium") return 56;
  return 34;
}

async function searchDoj(params: RegulatorySearchParams) {
  const q = enforcementApiQuery(params);
  if (!q) return { results: [] as RegulatorySearchResult[], warnings: ["DOJ search skipped: empty query."] };
  const warnings: string[] = [];
  const results: RegulatorySearchResult[] = [];
  const seen = new Set<string>();
  const retrievedAt = new Date().toISOString();

  const url = new URL("https://www.justice.gov/api/v1/press_releases.json");
  url.searchParams.set("fields", "title,url,uuid,date,body");
  url.searchParams.set("pagesize", "25");
  url.searchParams.set("sort", "date");
  url.searchParams.set("direction", "DESC");
  url.searchParams.set("parameters[title]", q);

  try {
    const res = await fetch(url.toString(), { cache: "no-store", headers: { accept: "application/json" } });
    const raw = (await res.json().catch(() => null)) as { results?: DojPressReleaseRow[] } | null;
    if (!res.ok) {
      warnings.push(`DOJ enforcement search failed for "${q}" (HTTP ${res.status}).`);
      return { results, warnings };
    }

    for (const row of raw?.results ?? []) {
      const title = stripHtml(row.title);
      const description = stripHtml(row.body);
      const detailUrl = clean(row.url);
      if (!enforcementTextMatchesQuery(q, title, description)) continue;
      const confidence = matchConfidenceFromQuery(q, [title, description]);
      if (confidence === "Low") continue;
      const strongSignal = DOJ_ENFORCEMENT_KEYWORDS.test(`${title} ${description}`);
      const key = clean(row.uuid) || detailUrl || title;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      results.push({
        result_id: rid(),
        source_id: "enforcements",
        source_name: "Enforcements",
        agency: "DOJ",
        category: "Federal Enforcement / DOJ Press Releases",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: title || "DOJ enforcement press release",
        record_type: strongSignal ? "enforcement press release" : "press release",
        record_subtype: "DOJ",
        description: description.slice(0, 360) || undefined,
        filing_or_record_date: parseEpochDate(row.date),
        detail_url: detailUrl || undefined,
        document_url: detailUrl || undefined,
        source_quote: description.slice(0, 280) || undefined,
        raw_json: row,
        confidence,
        importance_score: scoreImportance(confidence, strongSignal),
        notes: strongSignal ? "Matched from DOJ enforcement-related press release coverage." : undefined,
        retrieved_at: retrievedAt,
        request_url: url.toString(),
      });
    }
  } catch (error) {
    warnings.push(`DOJ enforcement search failed for "${q}": ${String(error)}`);
  }

  return { results, warnings };
}

function parseFtcCaseRows(html: string): FtcCaseRow[] {
  const $ = cheerio.load(html);
  return $("article.node--type-case.node--view-mode-search-result")
    .map((_, article) => {
      const root = $(article);
      const link = root.find("h3.node-title a").first();
      const title = clean(link.text());
      const detailUrl = absoluteFtcUrl(link.attr("href") ?? "");
      if (!title) return null;
      const description = clean(root.find(".field--name-body .field__item").first().text()) || undefined;
      const actionType = clean(root.find(".field--name-field-case-action-type .field__item").first().text()) || undefined;
      const lastUpdated =
        clean(root.find(".field--name-field-date time").first().text()) ||
        clean(root.find(".field--name-field-date .field__item").first().text()) ||
        undefined;
      const matterNumber =
        clean(
          root
            .find(".field--name-field-matter-number .field__item")
            .map((__, item) => $(item).text())
            .get()
            .join(", "),
        ) || undefined;
      const docketNumber =
        clean(
          root
            .find(".field--name-field-docket-number .field__item")
            .map((__, item) => $(item).text())
            .get()
            .join(", "),
        ) || undefined;
      const caseStatus = clean(root.find(".field--name-field-case-status .field__item").first().text()) || undefined;
      return { title, detailUrl, description, actionType, lastUpdated, matterNumber, docketNumber, caseStatus };
    })
    .get()
    .filter(Boolean) as FtcCaseRow[];
}

async function searchFtc(params: RegulatorySearchParams) {
  const q = enforcementApiQuery(params);
  if (!q) return { results: [] as RegulatorySearchResult[], warnings: ["FTC search skipped: empty query."] };
  const warnings: string[] = [];
  const results: RegulatorySearchResult[] = [];
  const seen = new Set<string>();
  const retrievedAt = new Date().toISOString();

  const url = new URL("https://www.ftc.gov/legal-library/browse/cases-proceedings");
  url.searchParams.set("search", q);
  url.searchParams.set("items_per_page", "10");
  url.searchParams.set("sort_by", "search_api_relevance");

  try {
    const res = await fetch(url.toString(), { cache: "no-store", headers: FTC_BROWSER_HEADERS });
    const html = await res.text();
    if (!res.ok) {
      warnings.push(`FTC enforcement search failed for "${q}" (HTTP ${res.status}).`);
      return { results, warnings };
    }
    if (/abusive automated request|PWH-Alert/i.test(html)) {
      warnings.push(
        `FTC blocked automated retrieval for "${q}". The tab still links to FTC's official cases library, but some FTC rows may be unavailable until the site allows the request.`,
      );
      return { results, warnings };
    }

    for (const row of parseFtcCaseRows(html)) {
      if (!enforcementTextMatchesQuery(q, row.title, row.description, row.matterNumber, row.docketNumber)) continue;
      const confidence = matchConfidenceFromQuery(q, [
        row.title,
        row.description,
        row.matterNumber,
        row.docketNumber,
      ]);
      if (confidence === "Low") continue;
      const key = row.detailUrl || row.title;
      if (!key || seen.has(key)) continue;
      seen.add(key);

      results.push({
        result_id: rid(),
        source_id: "enforcements",
        source_name: "Enforcements",
        agency: "FTC",
        category: "Federal Enforcement / FTC Cases and Proceedings",
        query_used: q,
        matched_entity: q,
        matched_entity_confidence: confidence,
        title: row.title,
        record_type: row.actionType || "FTC case",
        record_subtype: "FTC cases and proceedings",
        description: row.description,
        filing_or_record_date: row.lastUpdated,
        status: row.caseStatus,
        docket_number: row.docketNumber,
        agency_identifier: row.matterNumber || row.docketNumber,
        detail_url: row.detailUrl,
        document_url: row.detailUrl,
        source_quote: row.description?.slice(0, 280),
        raw_json: row,
        confidence,
        importance_score: scoreImportance(confidence, /pending|federal/i.test(`${row.caseStatus} ${row.actionType}`)),
        notes: [
          row.caseStatus ? `Case status: ${row.caseStatus}` : "",
          row.matterNumber ? `FTC matter number: ${row.matterNumber}` : "",
          row.docketNumber ? `Docket: ${row.docketNumber}` : "",
        ]
          .filter(Boolean)
          .join(". ") || undefined,
        retrieved_at: retrievedAt,
        request_url: url.toString(),
      });
    }
  } catch (error) {
    warnings.push(`FTC enforcement search failed for "${q}": ${String(error)}`);
  }

  return { results, warnings };
}

async function searchDol(params: RegulatorySearchParams) {
  const q = enforcementApiQuery(params);
  const response = await oshaAdapter.search(params);
  if (!response.ok) {
    return {
      results: [] as RegulatorySearchResult[],
      warnings: [`DOL / OSHA enforcement search failed: ${response.error}`],
    };
  }

  const results = response.results
    .filter((row) =>
      enforcementTextMatchesQuery(q, row.title, row.matched_entity, row.description, row.facility_name, row.notes),
    )
    .slice(0, 12)
    .map((row) => ({
    ...row,
    result_id: rid(),
    source_id: "enforcements",
    source_name: "Enforcements",
    agency: "DOL / OSHA",
    category: "Federal Enforcement / DOL OSHA Inspections and Citations",
    record_subtype: row.record_subtype || "OSHA inspection detail",
  }));

  const warnings = [
    "DOL coverage in this tab currently uses OSHA inspection / citation enforcement results, which is DOL's highest-value public company-enforcement surface.",
    ...((response.warnings ?? []).map((warning) => `DOL / OSHA: ${warning}`)),
  ];

  return { results, warnings };
}

export const enforcementsAdapter: RegulatoryAgencyAdapter = {
  sourceId: "enforcements",
  validateConfig: () => ({
    ok: true,
    mode: "no_key",
    message:
      "Searches DOJ enforcement-related press releases, FTC cases and proceedings, and DOL / OSHA enforcement results in one merged table.",
  }),
  search: async (params: RegulatorySearchParams) => {
    const q = clean(params.query);
    if (!q) return { ok: false, error: "Search query required." };

    const [doj, ftc, dol] = await Promise.allSettled([searchDoj(params), searchFtc(params), searchDol(params)]);
    const warnings: string[] = [];
    const results: RegulatorySearchResult[] = [];

    if (doj.status === "fulfilled") {
      results.push(...doj.value.results);
      warnings.push(...doj.value.warnings);
    } else {
      warnings.push(`DOJ enforcement search failed: ${String(doj.reason)}`);
    }

    if (ftc.status === "fulfilled") {
      results.push(...ftc.value.results);
      warnings.push(...ftc.value.warnings);
    } else {
      warnings.push(`FTC enforcement search failed: ${String(ftc.reason)}`);
    }

    if (dol.status === "fulfilled") {
      results.push(...dol.value.results);
      warnings.push(...dol.value.warnings);
    } else {
      warnings.push(`DOL / OSHA enforcement search failed: ${String(dol.reason)}`);
    }

    results.sort((a, b) => {
      const scoreDiff = (b.importance_score ?? 0) - (a.importance_score ?? 0);
      if (scoreDiff !== 0) return scoreDiff;
      return String(b.filing_or_record_date ?? "").localeCompare(String(a.filing_or_record_date ?? ""));
    });

    return {
      ok: true,
      raw: {
        sourceCounts: {
          doj: results.filter((row) => row.agency === "DOJ").length,
          ftc: results.filter((row) => row.agency === "FTC").length,
          dol: results.filter((row) => row.agency === "DOL / OSHA").length,
        },
      },
      results: results.slice(0, 50),
      warnings: warnings.length ? [...new Set(warnings)] : undefined,
    };
  },
};
