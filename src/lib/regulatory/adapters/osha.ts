import * as cheerio from "cheerio";
import { matchConfidenceFromQuery } from "@/lib/matchConfidenceFromQuery";
import type { RegulatoryAgencyAdapter, RegulatorySearchParams, RegulatorySearchResult } from "@/lib/regulatory/types";

type OshaSearchSummary = {
  activity: string;
  opened?: string;
  ridCode?: string;
  state?: string;
  type?: string;
  scope?: string;
  sic?: string;
  naics?: string;
  violations?: string;
  name?: string;
  detailUrl: string;
};

type OshaViolationItem = {
  citationId?: string;
  citationType?: string;
  standardCited?: string;
  issuanceDate?: string;
  abatementDueDate?: string;
  currentPenalty?: string;
  initialPenalty?: string;
  ftaPenalty?: string;
  contest?: string;
  latestEvent?: string;
  note?: string;
};

type OshaInspectionDetail = {
  caseStatus?: string;
  inspectionTitle?: string;
  office?: string;
  inspectionNumber?: string;
  reportId?: string;
  dateOpened?: string;
  siteAddress?: string;
  mailingAddress?: string;
  unionStatus?: string;
  sicDetail?: string;
  naicsDetail?: string;
  inspectionType?: string;
  scope?: string;
  advancedNotice?: string;
  ownership?: string;
  safetyHealth?: string;
  closeConference?: string;
  emphasis?: string;
  caseClosed?: string;
  currentViolationsTotal?: string;
  initialViolationsTotal?: string;
  currentPenaltyTotal?: string;
  initialPenaltyTotal?: string;
  ftaPenaltyTotal?: string;
  violationItems: OshaViolationItem[];
};

function rid() {
  return `osha_${Math.random().toString(16).slice(2)}_${Date.now().toString(16)}`;
}

function pad(v: number): string {
  return String(v).padStart(2, "0");
}

function clean(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function absoluteOshaUrl(href: string): string {
  if (!href) return "https://www.osha.gov/ords/imis/establishment.html";
  return href.startsWith("http") ? href : `https://www.osha.gov/ords/imis/${href.replace(/^\//, "")}`;
}

function buildOshaSearchUrl(query: string, state?: string): string {
  const end = new Date();
  const start = new Date(end);
  start.setFullYear(end.getFullYear() - 5);
  const url = new URL("https://www.osha.gov/ords/imis/establishment.search");
  url.searchParams.set("establishment", query);
  url.searchParams.set("state", state?.trim().toUpperCase() || "all");
  url.searchParams.set("officetype", "all");
  url.searchParams.set("office", "all");
  url.searchParams.set("sitezip", "100000");
  url.searchParams.set("startmonth", pad(start.getMonth() + 1));
  url.searchParams.set("startday", pad(start.getDate()));
  url.searchParams.set("startyear", String(start.getFullYear()));
  url.searchParams.set("endmonth", pad(end.getMonth() + 1));
  url.searchParams.set("endday", pad(end.getDate()));
  url.searchParams.set("endyear", String(end.getFullYear()));
  url.searchParams.set("p_case", "all");
  url.searchParams.set("p_violations_exist", "both");
  url.searchParams.set("p_sort", "12");
  url.searchParams.set("p_desc", "DESC");
  url.searchParams.set("p_show", "20");
  return url.toString();
}

function parseOshaSearchResults(html: string): OshaSearchSummary[] {
  const $ = cheerio.load(html);
  const results: OshaSearchSummary[] = [];

  $("a[href*='establishment.inspection_detail']").each((_, anchor) => {
    const row = $(anchor).closest("tr");
    const cells = row.find("td");
    if (cells.length < 12) return;

    const href = $(anchor).attr("href")?.trim() ?? "";
    results.push({
      activity: clean($(cells[2]).text()),
      opened: clean($(cells[3]).text()) || undefined,
      ridCode: clean($(cells[4]).text()) || undefined,
      state: clean($(cells[5]).text()) || undefined,
      type: clean($(cells[6]).text()) || undefined,
      scope: clean($(cells[7]).text()) || undefined,
      sic: clean($(cells[8]).text()) || undefined,
      naics: clean($(cells[9]).text()) || undefined,
      violations: clean($(cells[10]).text()) || undefined,
      name: clean($(cells[11]).text()) || undefined,
      detailUrl: absoluteOshaUrl(href),
    });
  });

  return results;
}

function extractNamedValue($: cheerio.CheerioAPI, label: string): string | undefined {
  let result: string | undefined;
  $("#maincontain")
    .find("p strong, div strong")
    .each((_, strong) => {
      if (result) return;
      const labelText = clean($(strong).text()).replace(/:$/, "");
      if (labelText !== label) return;
      const parent = $(strong).parent().clone();
      parent.find("strong").remove();
      const value = clean(parent.text());
      if (value) result = value;
    });
  return result;
}

function parseViolationSummary($: cheerio.CheerioAPI) {
  const table = $("caption")
    .filter((_, el) => clean($(el).text()) === "Violation Summary")
    .first()
    .closest("table");
  if (!table.length) return {};

  const summaryByRow: Record<string, string[]> = {};
  table.find("tr").each((_, tr) => {
    const rowHeader = clean($(tr).find("th[scope='row']").first().text());
    if (!rowHeader) return;
    summaryByRow[rowHeader] = $(tr)
      .find("td")
      .map((__, td) => clean($(td).text()))
      .get();
  });

  const currentViolations = summaryByRow["Current Violations"] ?? [];
  const initialViolations = summaryByRow["Initial Violations"] ?? [];
  const currentPenalty = summaryByRow["Current Penalty"] ?? [];
  const initialPenalty = summaryByRow["Initial Penalty"] ?? [];
  const ftaPenalty = summaryByRow["FTA Penalty"] ?? [];

  return {
    initialViolationsTotal: initialViolations.at(-1) || undefined,
    currentViolationsTotal: currentViolations.at(-1) || undefined,
    initialPenaltyTotal: initialPenalty.at(-1) || undefined,
    currentPenaltyTotal: currentPenalty.at(-1) || undefined,
    ftaPenaltyTotal: ftaPenalty.at(-1) || undefined,
  };
}

function parseViolationItems($: cheerio.CheerioAPI): OshaViolationItem[] {
  const table = $("caption")
    .filter((_, el) => clean($(el).text()) === "Violation Items")
    .first()
    .closest("table");
  if (!table.length) return [];

  const items: OshaViolationItem[] = [];
  table.find("tr").each((index, tr) => {
    if (index === 0) return;
    const cells = $(tr).find("td");
    if (cells.length < 11) return;
    items.push({
      citationId: clean($(cells[0]).text()) || undefined,
      citationType: clean($(cells[1]).text()) || undefined,
      standardCited: clean($(cells[2]).text()) || undefined,
      issuanceDate: clean($(cells[3]).text()) || undefined,
      abatementDueDate: clean($(cells[4]).text()) || undefined,
      currentPenalty: clean($(cells[5]).text()) || undefined,
      initialPenalty: clean($(cells[6]).text()) || undefined,
      ftaPenalty: clean($(cells[7]).text()) || undefined,
      contest: clean($(cells[8]).text()) || undefined,
      latestEvent: clean($(cells[9]).text()) || undefined,
      note: clean($(cells[10]).text()) || undefined,
    });
  });
  return items;
}

async function fetchOshaInspectionDetail(detailUrl: string): Promise<OshaInspectionDetail> {
  const res = await fetch(detailUrl, { cache: "no-store", headers: { accept: "text/html,*/*" } });
  const html = await res.text();
  if (!res.ok) {
    throw new Error(`OSHA inspection detail failed (HTTP ${res.status}).`);
  }

  const $ = cheerio.load(html);
  const main = $("#maincontain");
  const titleLine = clean(main.find("h4 strong").first().text());
  const officeLine = clean(main.find("p strong").first().text());
  const caseStatus = clean(main.find(".well.well-small strong").first().text()).replace(/^Case Status:\s*/i, "");
  const summary = parseViolationSummary($);
  const violationItems = parseViolationItems($);

  return {
    caseStatus: caseStatus || undefined,
    inspectionTitle: titleLine.replace(/^Inspection:\s*/i, "") || undefined,
    office: officeLine.replace(/^Inspection Information - Office:\s*/i, "") || undefined,
    inspectionNumber: extractNamedValue($, "Inspection Nr"),
    reportId: extractNamedValue($, "Report ID"),
    dateOpened: extractNamedValue($, "Date Opened"),
    siteAddress: extractNamedValue($, "Site Address"),
    mailingAddress: extractNamedValue($, "Mailing Address"),
    unionStatus: extractNamedValue($, "Union Status"),
    sicDetail: extractNamedValue($, "SIC"),
    naicsDetail: extractNamedValue($, "NAICS"),
    inspectionType: extractNamedValue($, "Inspection Type"),
    scope: extractNamedValue($, "Scope"),
    advancedNotice: extractNamedValue($, "Advanced Notice"),
    ownership: extractNamedValue($, "Ownership"),
    safetyHealth: extractNamedValue($, "Safety/Health"),
    closeConference: extractNamedValue($, "Close Conference"),
    emphasis: extractNamedValue($, "Emphasis"),
    caseClosed: extractNamedValue($, "Case Closed"),
    ...summary,
    violationItems,
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, mapper: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const current = nextIndex;
      nextIndex += 1;
      if (current >= items.length) return;
      results[current] = await mapper(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export const oshaAdapter: RegulatoryAgencyAdapter = {
  sourceId: "osha",
  validateConfig: () => ({ ok: true, mode: "no_key", message: "Searching OSHA establishment inspection and citation detail results." }),
  search: async (params: RegulatorySearchParams) => {
    const q = params.query?.trim();
    if (!q) return { ok: false, error: "Search query required." };

    const url = buildOshaSearchUrl(q, params.state);
    const res = await fetch(url, { cache: "no-store", headers: { accept: "text/html,*/*" } });
    const html = await res.text();
    if (!res.ok) {
      return {
        ok: false,
        error: `OSHA establishment search failed (HTTP ${res.status}).`,
        requestUrl: url,
        raw: html.slice(0, 1000),
      };
    }

    const summaries = parseOshaSearchResults(html);
    const retrievedAt = new Date().toISOString();
    const warnings: string[] = [];

    const detailed = await mapWithConcurrency(summaries, 5, async (summary) => {
      try {
        return { summary, detail: await fetchOshaInspectionDetail(summary.detailUrl) };
      } catch (error) {
        return { summary, detail: null as OshaInspectionDetail | null, error: String(error) };
      }
    });

    const detailFailures = detailed.filter((item) => item.detail === null).length;
    if (detailFailures > 0) {
      warnings.push(`OSHA detail enrichment failed for ${detailFailures} inspection result(s); those rows fall back to search-summary data.`);
    }

    const results: RegulatorySearchResult[] = detailed.map(({ summary, detail }) => {
      const detailState = detail?.siteAddress?.match(/,\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?$/)?.[1];
      const confidence = matchConfidenceFromQuery(q, [
        summary.name,
        summary.state,
        summary.type,
        summary.scope,
        detail?.siteAddress,
        detail?.office,
      ]);
      const currentViolations = clean(detail?.currentViolationsTotal);
      const currentPenalty = clean(detail?.currentPenaltyTotal);
      const topCitationNotes = (detail?.violationItems ?? [])
        .slice(0, 3)
        .map((item) =>
          [item.citationType, item.standardCited, item.currentPenalty ? `penalty ${item.currentPenalty}` : "", item.latestEvent]
            .filter(Boolean)
            .join(" / "),
        )
        .filter(Boolean);

      return {
        result_id: rid(),
        source_id: "osha",
        source_name: "OSHA",
        agency: "OSHA",
        category: "Workplace Safety / Inspections / Citations",
        query_used: q,
        matched_entity: summary.name || q,
        matched_entity_confidence: confidence,
        title: summary.name || `OSHA inspection ${summary.activity}`,
        record_type: detail?.inspectionType || summary.type || "inspection",
        record_subtype: detail?.scope || summary.scope || undefined,
        description: [
          detail?.naicsDetail || (summary.naics ? `NAICS ${summary.naics}` : ""),
          detail?.office ? `Office ${detail.office}` : "",
          summary.ridCode ? `RID ${summary.ridCode}` : "",
        ]
          .filter(Boolean)
          .join(" · ") || undefined,
        filing_or_record_date: detail?.dateOpened || summary.opened || undefined,
        last_updated: detail?.caseClosed || detail?.closeConference || undefined,
        status: detail?.caseStatus || undefined,
        state: detailState || summary.state || undefined,
        facility_name: summary.name || undefined,
        facility_address: detail?.siteAddress || undefined,
        case_number: summary.activity || undefined,
        agency_identifier: detail?.reportId || summary.activity || undefined,
        detail_url: summary.detailUrl,
        raw_source_url: summary.detailUrl,
        raw_json: {
          summary,
          detail,
        },
        confidence,
        importance_score:
          currentPenalty && currentPenalty !== "$0"
            ? 88
            : currentViolations && currentViolations !== "0"
              ? 78
              : summary.violations && summary.violations !== "\u00a0"
                ? 72
                : 45,
        notes: [
          detail?.caseStatus ? `Case ${detail.caseStatus}` : "",
          currentViolations ? `${currentViolations} current violation(s)` : summary.violations ? `${summary.violations} violations listed in search results` : "",
          currentPenalty ? `current penalty ${currentPenalty}` : "",
          detail?.caseClosed ? `closed ${detail.caseClosed}` : "",
          detail?.ownership ? `ownership ${detail.ownership}` : "",
          detail?.unionStatus ? `union ${detail.unionStatus}` : "",
          topCitationNotes.length ? `Top citations: ${topCitationNotes.join("; ")}` : "",
        ]
          .filter(Boolean)
          .join(". ") || undefined,
        retrieved_at: retrievedAt,
        request_url: url,
      };
    });

    return {
      ok: true,
      requestUrl: url,
      raw: { htmlLength: html.length, resultCount: summaries.length, detailFailures },
      results,
      warnings: warnings.length ? warnings : undefined,
    };
  },
};
