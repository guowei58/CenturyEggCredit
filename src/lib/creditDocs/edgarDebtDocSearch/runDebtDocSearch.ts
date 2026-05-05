import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";
import { buildArchivesFileUrl } from "@/lib/sec/filingIndex";
import type { SecFiling } from "@/lib/sec-edgar";

import { buildAmendmentChain, crossCheckDebtFootnote } from "@/lib/creditDocs/edgarDebtDocSearch/amendmentAndFootnote";
import {
  classifyExhibit,
  extractCreditParties,
  extractDebtTerms,
  extractEightKItems,
} from "@/lib/creditDocs/edgarDebtDocSearch/classifyAndExtract";
import { exhibitContextSnippet, parseExhibitIndex } from "@/lib/creditDocs/edgarDebtDocSearch/exhibitParsing";
import {
  fetchCompanySubmissions,
  getRelevantFilings,
  resolveTickerToCIK,
} from "@/lib/creditDocs/edgarDebtDocSearch/identityAndFilings";
import { textMatchesDebtKeywordBlob } from "@/lib/creditDocs/edgarDebtDocSearch/keywords";
import { fetchFilingIndex, secFetchText } from "@/lib/creditDocs/edgarDebtDocSearch/secFetch";
import { sanitizeSecInstrumentTitle } from "@/lib/creditDocs/sanitizeSecInstrumentTitle";
import type {
  DebtDocumentTableRow,
  DebtDocSearchInputs,
  EdgarDebtDocSearchResult,
  ExecutiveSummary,
} from "@/lib/creditDocs/edgarDebtDocSearch/types";

import { inferCreditDocumentTitleType } from "@/lib/creditDocs/findCreditDocuments";

const DEFAULT_MAX_FILINGS_CAP = 75;
const DEFAULT_MAX_DOWNLOAD_CLASSIFY = 36;

const PRIORITY_8K_ITEMS = new Set([
  "Item 1.01",
  "Item 1.02",
  "Item 2.03",
  "Item 2.04",
  "Item 3.03",
  "Item 7.01",
  "Item 8.01",
  "Item 9.01",
]);

function skipAttachment(name: string): boolean {
  const l = name.toLowerCase();
  if (/index-|xslf|\.xsl$|\.css$/i.test(l)) return true;
  if (/\.(gif|jpg|jpeg|png|ico)$/i.test(l)) return true;
  return false;
}

function guessExhibitFromFilename(fn: string): string {
  const base = fn.split("/").pop() ?? fn;
  const m = base.match(/(?:ex|exhibit)[_-]?(\d+(?:\.\d+)?)/i);
  return m?.[1] ?? "";
}

function exhibitPassesDebtGate(filename: string, description: string): boolean {
  const blob = `${filename} ${description}`;
  const base = filename.split("/").pop() ?? filename;

  const ex4 = /\b(?:EX-?4|Exhibit\s*4|dex\d*4\d)/i.test(blob);
  const ex10 = /\b(?:EX-?10|Exhibit\s*10|dex\d*10\d)/i.test(blob);
  const ex99 = /\b(?:EX-?99|Exhibit\s*99|dex\d*99\d)/i.test(blob);
  const ex2 = /\b(?:EX-?2|Exhibit\s*2|dex\d*2\d)/i.test(blob);
  const ex1 = /\b(?:EX-?1[^0-9]|Exhibit\s*1[^0-9])/i.test(blob);
  const ex25 = /\b(?:EX-?25|Exhibit\s*25)/i.test(blob);

  if (ex4) return true;
  if (ex25 && textMatchesDebtKeywordBlob(blob)) return true;
  if (ex10) return textMatchesDebtKeywordBlob(blob) || inferCreditDocumentTitleType(base) !== "other";
  if (ex99 || ex2 || ex1) return textMatchesDebtKeywordBlob(blob);
  return textMatchesDebtKeywordBlob(blob);
}

function registrationPrimaryDebtGate(form: string, filing: SecFiling): boolean {
  const f = form.trim().toUpperCase();
  const blob = `${filing.primaryDocument} ${filing.description}`;
  if (f.startsWith("424")) {
    if (/^424B[2579]/i.test(f)) return true;
    return textMatchesDebtKeywordBlob(blob) || inferCreditDocumentTitleType(blob) !== "other";
  }
  if (f.startsWith("FWP") || f.startsWith("S-3") || f.startsWith("S-4")) {
    return textMatchesDebtKeywordBlob(blob) || inferCreditDocumentTitleType(blob) !== "other";
  }
  return false;
}

function dedupeRows(rows: DebtDocumentTableRow[]): DebtDocumentTableRow[] {
  const seen = new Set<string>();
  const out: DebtDocumentTableRow[] = [];
  for (const r of rows) {
    const k = r.directExhibitLink.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

function bucketForRow(r: DebtDocumentTableRow): string {
  const dt = `${r.documentType} ${r.instrumentOrFacilityName}`.toLowerCase();
  if (/dip|debtor-in-possession/.test(dt)) return "DIP / exit financing";
  if (/exit\s+facility|exit\s+financing/.test(dt)) return "DIP / exit financing";
  if (/credit|term loan|revolv|abl|facility/.test(dt)) return "Revolver / ABL / term loan";
  if (/secured/.test(dt) && /note|indenture/.test(dt)) return "Secured notes";
  if (/indenture|form of note|global note/.test(dt)) return "Unsecured notes";
  if (/convertible|exchangeable/.test(dt)) return "Convertible / exchangeable notes";
  if (/abs|securitization|receivable/.test(dt)) return "Securitization / ABS facilities";
  return "Other";
}

function groupDebtMap(table: DebtDocumentTableRow[]): Record<string, DebtDocumentTableRow[]> {
  const map: Record<string, DebtDocumentTableRow[]> = {};
  for (const r of table) {
    const g = bucketForRow(r);
    if (!map[g]) map[g] = [];
    map[g].push(r);
  }
  return map;
}

function buildExecutiveSummary(
  table: DebtDocumentTableRow[],
  missing: Array<{ instrumentOrDescription: string; reason: string }>
): ExecutiveSummary {
  const creditAgreements = table.filter((r) => /credit agreement/i.test(r.documentType)).length;
  const indentures = table.filter((r) => /indenture|notes/i.test(r.documentType)).length;
  const amendments = table.filter((r) => /amendment|waiver|consent/i.test(r.documentType)).length;
  return {
    debtRelatedDocumentsFound: table.length,
    creditAgreementsFound: creditAgreements,
    indenturesNoteDocumentsFound: indentures,
    amendmentsFound: amendments,
    materialMissingDocuments: missing.slice(0, 18).map((m) => m.instrumentOrDescription),
  };
}

function buildRecommendations(companyLegalName: string, table: DebtDocumentTableRow[]): string[] {
  const out: string[] = [];
  out.push(`Re-run with subsidiary / co-issuer names extracted from guarantees and Exhibit 21 (${companyLegalName}).`);
  const forms = new Set(table.map((t) => t.filingForm));
  if (![...forms].some((f) => f.startsWith("8-K"))) {
    out.push("Pull additional 8-K history — material credit agreements often appear as Item 1.01 / 9.01 exhibits.");
  }
  out.push("Manually resolve incorporated-by-reference exhibits to the definitive EDGAR filing URL.");
  out.push("Cross-read latest 10-Q MD&A and debt footnote XBRL for instruments not captured by filename heuristics.");
  return out;
}

/**
 * Full EDGAR debt-document search (spec Steps 1–10) — source-backed SEC URLs only.
 */
export async function runDebtDocSearch(input: DebtDocSearchInputs): Promise<EdgarDebtDocSearchResult | null> {
  const id = await resolveTickerToCIK({
    ticker: input.ticker,
    companyName: input.companyName,
    cik: input.cik,
  });
  if (!id) return null;

  const subs = await fetchCompanySubmissions(id.cikPadded);
  if (!subs) return null;

  const lookback = input.lookbackYears ?? 10;
  const filingsCap = Math.min(180, Math.max(20, input.maxFilingsCap ?? DEFAULT_MAX_FILINGS_CAP));
  const downloadCap = Math.min(72, Math.max(12, input.maxDownloadClassify ?? DEFAULT_MAX_DOWNLOAD_CLASSIFY));
  const relevant = getRelevantFilings(subs.filings, {
    lookbackYears: lookback,
    includeDef14a: input.includeDef14a ?? false,
  });
  const capped = relevant.slice(0, filingsCap);

  const primaryHtmlCache = new Map<string, string | null>();
  async function loadPrimaryHtml(f: SecFiling): Promise<string | null> {
    if (primaryHtmlCache.has(f.accessionNumber)) return primaryHtmlCache.get(f.accessionNumber) ?? null;
    const html = await secFetchText(f.docUrl, 45 * 60 * 1000);
    primaryHtmlCache.set(f.accessionNumber, html);
    return html;
  }

  const latestTenKFiling = capped.find((f) => f.form.startsWith("10-K"));
  let latestTenKPlain = "";
  if (latestTenKFiling) {
    const h = await loadPrimaryHtml(latestTenKFiling);
    latestTenKPlain = h ?? "";
  }

  const rawRows: DebtDocumentTableRow[] = [];
  let exhibitsIndexed = 0;
  let downloaded = 0;

  let periodicPrimaryBudget = 10;
  let eightKPrimaryBudget = 18;

  for (const filing of capped) {
    const filingLink = filing.docUrl;

    let primaryHtml: string | null = null;
    if (filing.form.startsWith("8-K") && eightKPrimaryBudget > 0) {
      primaryHtml = await loadPrimaryHtml(filing);
      eightKPrimaryBudget--;
    } else if (
      (filing.form.startsWith("10-K") || filing.form.startsWith("10-Q")) &&
      periodicPrimaryBudget > 0
    ) {
      primaryHtml = await loadPrimaryHtml(filing);
      periodicPrimaryBudget--;
    }

    let eightKItems: string[] = [];
    if (primaryHtml && filing.form.startsWith("8-K")) {
      eightKItems = extractEightKItems(primaryHtml);
    }

    const htmlRows = primaryHtml ? parseExhibitIndex(primaryHtml) : [];
    const htmlByFile = new Map<string, (typeof htmlRows)[0]>();
    for (const r of htmlRows) {
      if (r.filename) htmlByFile.set(r.filename.replace(/^.*\//, ""), r);
    }

    if (registrationPrimaryDebtGate(filing.form, filing)) {
      const url = filing.docUrl.trim();
      const blob = `${filing.primaryDocument} ${filing.description}`;
      let sample = "";
      if (downloaded < downloadCap) {
        const fet = await downloadAndExtractSecDocument(url);
        downloaded++;
        sample = fet.text.slice(0, 14_000);
      }
      const docType = classifyExhibit(blob, sample);
      const parties = extractCreditParties(sample);
      const terms = extractDebtTerms(sample);

      rawRows.push({
        status: "Found",
        instrumentOrFacilityName: sanitizeSecInstrumentTitle(
          filing.description?.trim() || filing.primaryDocument
        ).slice(0, 240),
        documentType: docType,
        exhibitNumber: "Primary",
        filingForm: filing.form,
        filingDate: filing.filingDate,
        filingItemEightK: null,
        accessionNumber: filing.accessionNumber,
        directExhibitLink: url,
        filingLink,
        borrowerIssuer: parties.borrowerIssuer ?? null,
        guarantorsCreditParties: parties.guarantorsCreditParties ?? null,
        agentTrustee: parties.agentTrustee ?? null,
        principalAmount: terms.principalAmount ?? null,
        maturity: terms.maturity ?? null,
        securedUnsecured: terms.securedUnsecured ?? null,
        lienPriority: terms.lienPriority ?? null,
        amendmentSequence: "—",
        baseDocumentLink: null,
        notesWhyRelevant: "Primary document on registration / FWP / selected prospectus-style filing (debt keyword gate).",
        confidenceLevel: sample.length > 900 ? "Medium" : "Low",
        sourceSnippet: (sample.slice(0, 400) || blob).slice(0, 420),
      });
    }

    const indexItems = await fetchFilingIndex(id.cikPadded, filing.accessionNumber);
    exhibitsIndexed += indexItems.length;

    for (const it of indexItems) {
      const name = it.name;
      if (!name || skipAttachment(name) || name === filing.primaryDocument) continue;

      const baseName = name.split("/").pop() ?? name;
      const meta = htmlByFile.get(baseName);
      const desc = meta?.description ?? (primaryHtml ? exhibitContextSnippet(primaryHtml, baseName) : "");
      const exhibitNumMeta = meta?.exhibitNumber ?? "";

      if (!exhibitPassesDebtGate(name, desc)) continue;

      const exhibitUrl = buildArchivesFileUrl(id.cikNumeric, filing.accessionNumber, name);
      const ibr = /incorporated\s+by\s+reference/i.test(desc);

      let sample = "";
      if (!ibr && downloaded < downloadCap) {
        const fet = await downloadAndExtractSecDocument(exhibitUrl);
        downloaded++;
        sample = fet.text.slice(0, 14_000);
      }

      const docType = classifyExhibit(`${name} ${desc}`, sample);
      const parties = extractCreditParties(sample);
      const terms = extractDebtTerms(sample);

      let filingItemEightK: string | null = null;
      if (filing.form.startsWith("8-K") && eightKItems.length) {
        const hits = eightKItems.filter((i) => PRIORITY_8K_ITEMS.has(i));
        filingItemEightK = (hits.length ? hits : eightKItems.slice(0, 8)).join("; ");
      }

      const confidence =
        sample.length > 2800 ? "High" : sample.length > 450 ? "Medium" : desc.length > 35 ? "Medium" : "Low";

      rawRows.push({
        status: ibr ? "Incorporated by reference" : "Found",
        instrumentOrFacilityName: sanitizeSecInstrumentTitle(desc || name).slice(0, 240),
        documentType: docType,
        exhibitNumber: exhibitNumMeta || guessExhibitFromFilename(name) || "—",
        filingForm: filing.form,
        filingDate: filing.filingDate,
        filingItemEightK,
        accessionNumber: filing.accessionNumber,
        directExhibitLink: exhibitUrl,
        filingLink,
        borrowerIssuer: parties.borrowerIssuer ?? null,
        guarantorsCreditParties: parties.guarantorsCreditParties ?? null,
        agentTrustee: parties.agentTrustee ?? null,
        principalAmount: terms.principalAmount ?? null,
        maturity: terms.maturity ?? null,
        securedUnsecured: terms.securedUnsecured ?? null,
        lienPriority: terms.lienPriority ?? null,
        amendmentSequence: "—",
        baseDocumentLink: null,
        notesWhyRelevant: ibr
          ? "Exhibit context suggests incorporation by reference — locate definitive exhibit filing."
          : `SEC filing attachment (${filing.form}) — directory + exhibit-gate heuristics.`,
        confidenceLevel: confidence,
        sourceSnippet: (sample.slice(0, 380) || `${name} — ${desc}`).slice(0, 420),
      });
    }
  }

  const deduped = dedupeRows(rawRows);
  const chained = buildAmendmentChain(deduped);
  const missingChecklist = crossCheckDebtFootnote(latestTenKPlain, chained);

  const executiveSummary = buildExecutiveSummary(chained, missingChecklist);
  const debtDocumentMap = groupDebtMap(chained);
  const recommendedNextSearches = buildRecommendations(subs.companyName, chained);

  return {
    identity: {
      cikPadded: id.cikPadded,
      cikNumeric: id.cikNumeric,
      ticker: input.ticker?.trim().toUpperCase() ?? id.ticker,
      companyLegalName: subs.companyName,
    },
    executiveSummary,
    debtDocumentMap,
    table: chained.sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || "")),
    missingChecklist,
    recommendedNextSearches,
    rawAudit: {
      filingsConsidered: capped.length,
      exhibitsIndexed,
      exhibitsDownloadedForClassification: downloaded,
    },
  };
}
