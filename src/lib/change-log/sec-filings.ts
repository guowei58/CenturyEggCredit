import {
  getCikFromTicker,
  getFilingsByCik,
  getSecEdgarUserAgent,
  secArchivesPrimaryDocumentUrl,
  secRemoteFetchInit,
  type SecFiling,
} from "@/lib/sec-edgar";
import { isFilingDateInChangeLogPeriod, type ChangeLogPeriodBounds } from "./period";
import type { ChangeLogSourceCandidate } from "./types";
import { changeLogDedupeKey } from "./dedupe";

/** SEC Forms 3 / 4 / 5 (+ amendments) — insider ownership. */
function isInsiderOwnershipForm(form: string): boolean {
  return /^[345](\/A)?$/i.test(form.trim());
}

/** Normalize form for materiality checks (strip amendment suffix). */
function baseSecForm(form: string): string {
  return form.trim().toUpperCase().replace(/\s+/g, " ").replace(/\/A$/i, "");
}

const MATERIAL_SEC_FORMS = new Set([
  "8-K",
  "10-Q",
  "10-K",
  "6-K",
  "20-F",
  "DEF 14A",
  "PRE 14A",
  "S-1",
  "S-3",
  "F-1",
  "424B",
  "425",
  "SC 13D",
  "SC 13G",
  "SC TO-T",
  "SC TO-C",
  "DEFM14A",
  "DEFR14A",
  "PREM14A",
  "POS AM",
]);

export function isMaterialChangeLogSecForm(form: string): boolean {
  const raw = form.trim();
  if (!raw) return false;
  if (isInsiderOwnershipForm(raw)) return true;
  const base = baseSecForm(raw);
  if (base.startsWith("424B")) return true;
  if (MATERIAL_SEC_FORMS.has(base)) return true;
  if (/^SC 13[DG]/i.test(raw)) return true;
  if (/^SC TO-/i.test(raw)) return true;
  return false;
}

function secFilingRelevance(f: SecFiling): string {
  const form = f.form.trim().toUpperCase();
  if (isInsiderOwnershipForm(form)) {
    return "Insider / beneficial ownership filing — review timing and size vs. your thesis.";
  }
  if (form.startsWith("8-K")) {
    return "Current report — often material events, earnings, financing, or management changes.";
  }
  if (form.startsWith("10-Q") || form.startsWith("10-K") || form.startsWith("6-K") || form.startsWith("20-F")) {
    return "Periodic financial disclosure — compare to your model, covenants, and liquidity view.";
  }
  if (form.includes("14A")) {
    return "Proxy / governance — executive comp, votes, and key proposals.";
  }
  if (form.startsWith("424") || form.startsWith("S-1") || form.startsWith("S-3") || form.startsWith("F-1")) {
    return "Seculatory offering / registration — capital structure and dilution risk.";
  }
  return "SEC filing — verify facts against your thesis and catalyst list.";
}

function secFilingToCandidate(
  ticker: string,
  cik: string,
  f: SecFiling
): ChangeLogSourceCandidate {
  const docUrl =
    secArchivesPrimaryDocumentUrl(cik, f) ?? f.docUrl?.trim() ?? "";
  const headline = `${f.form}: ${f.description || f.primaryDocument || "Filing"}`;
  const summary = `${f.form} filed ${f.filingDate}. ${f.description ?? ""}`.trim();
  return {
    dedupeKey: changeLogDedupeKey(docUrl, f.accessionNumber),
    date: f.filingDate.slice(0, 10),
    title: headline,
    summary,
    url: docUrl,
    sourceName: "SEC EDGAR",
    sourceType: "sec",
    accessionNumber: f.accessionNumber,
    form: f.form,
    publishedAtIso: `${f.filingDate.slice(0, 10)}T12:00:00.000Z`,
    investmentRelevance: secFilingRelevance(f),
  };
}

export type FetchChangeLogSecResult = {
  candidates: ChangeLogSourceCandidate[];
  cik: string | null;
  companyName: string | null;
  totalFilingsFetched: number;
  inPeriodCount: number;
  materialInPeriodCount: number;
  error: string | null;
};

/**
 * Fetch SEC EDGAR submissions for a ticker and return material filings in the update window.
 * Surfaces explicit errors when CIK resolution or EDGAR access fails (never silent null).
 */
export async function fetchChangeLogSecFilings(
  ticker: string,
  bounds: ChangeLogPeriodBounds,
  excludeDedupeKeys: Set<string>
): Promise<FetchChangeLogSecResult> {
  const sym = ticker.trim().toUpperCase();
  const empty: FetchChangeLogSecResult = {
    candidates: [],
    cik: null,
    companyName: null,
    totalFilingsFetched: 0,
    inPeriodCount: 0,
    materialInPeriodCount: 0,
    error: null,
  };

  let cik: string | null;
  try {
    cik = await getCikFromTicker(sym);
  } catch (e) {
    return { ...empty, error: `CIK lookup failed: ${e instanceof Error ? e.message : String(e)}` };
  }

  if (!cik) {
    return {
      ...empty,
      error: `No SEC CIK found for ticker ${sym}. Key Updates SEC filings require a listed SEC registrant.`,
    };
  }

  let pack: Awaited<ReturnType<typeof getFilingsByCik>> = null;
  try {
    pack = await getFilingsByCik(cik);
  } catch (e) {
    return {
      ...empty,
      cik,
      error: `SEC EDGAR submissions fetch failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!pack) {
    const padded = cik.replace(/\D/g, "").padStart(10, "0");
    const url = `https://data.sec.gov/submissions/CIK${padded}.json`;
    try {
      const res = await fetch(url, secRemoteFetchInit());
      if (!res.ok) {
        const hint =
          res.status === 403
            ? " Set SEC_EDGAR_USER_AGENT (app name + email) in server env and redeploy."
            : "";
        return {
          ...empty,
          cik,
          error: `SEC EDGAR returned HTTP ${res.status} for CIK ${padded}.${hint}`,
        };
      }
    } catch (e) {
      return {
        ...empty,
        cik,
        error: `SEC EDGAR unreachable: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
    return {
      ...empty,
      cik,
      error: `SEC EDGAR returned no submissions data for CIK ${cik}.`,
    };
  }

  const filings = pack.filings ?? [];
  const inPeriod = filings.filter((f) => isFilingDateInChangeLogPeriod(f.filingDate, bounds));
  const material = inPeriod.filter((f) => isMaterialChangeLogSecForm(f.form));

  const seen = new Set<string>();
  const candidates: ChangeLogSourceCandidate[] = [];
  for (const f of material) {
    const c = secFilingToCandidate(sym, cik, f);
    if (!c.url) continue;
    if (excludeDedupeKeys.has(c.dedupeKey) || seen.has(c.dedupeKey)) continue;
    seen.add(c.dedupeKey);
    candidates.push(c);
  }

  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));

  return {
    candidates,
    cik,
    companyName: pack.companyName ?? null,
    totalFilingsFetched: filings.length,
    inPeriodCount: inPeriod.length,
    materialInPeriodCount: material.length,
    error: null,
  };
}

/** Exported for diagnostics — SEC expects a descriptive User-Agent on server requests. */
export function changeLogSecUserAgentHint(): string {
  return getSecEdgarUserAgent();
}
