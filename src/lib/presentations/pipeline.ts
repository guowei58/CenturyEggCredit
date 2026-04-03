/**
 * Presentations pipeline: resolve ticker → override? → candidates → Claude select → crawl → extract → optional Claude rank → response.
 */

import { getCompanyProfile } from "@/lib/sec-edgar";
import type { PdfLink } from "@/lib/presentations-types";
import type { PresentationsApiResponse, PresentationsFallback, PresentationsSuccess } from "@/lib/presentations-types";
import { selectWebsiteAndIr, rankPdfs } from "./claude";
import { getCandidateWebsites } from "./candidates";
import { crawlOfficialSiteAndExtractPdfs } from "./crawl";
import { getOverride } from "./overrides";

export async function runPresentationsPipeline(
  ticker: string,
  options: { useOverride?: string | null; refresh?: boolean; userId?: string | null } = {}
): Promise<PresentationsApiResponse> {
  const safeTicker = ticker.trim().toUpperCase();
  if (!safeTicker) {
    return { ok: false, companyName: safeTicker, ticker: safeTicker, message: "Ticker required.", candidateWebsites: [] };
  }

  const profile = await getCompanyProfile(safeTicker);
  const companyName = profile?.name ?? safeTicker;

  const overrideUrl =
    options.useOverride ??
    (options.userId ? await getOverride(options.userId, safeTicker) : null);

  if (overrideUrl && overrideUrl.startsWith("http")) {
    const pdfsRaw = await crawlOfficialSiteAndExtractPdfs(overrideUrl, null);
    const forRanking = pdfsRaw.map((p) => ({ ...p }));
    const ranked = await rankPdfs(forRanking);
    const pdfs: PdfLink[] = (ranked ?? pdfsRaw.map((p) => ({ ...p, classification: "Other PDF" as const }))).map(
      (p) => ({
        url: p.url,
        title: p.title,
        sourcePage: p.sourcePage,
        date: p.date,
        classification: p.classification,
      })
    );
    const success: PresentationsSuccess = {
      ok: true,
      companyName,
      ticker: safeTicker,
      officialWebsite: overrideUrl,
      irPage: null,
      confidence: "high",
      notes: "Using your saved website override.",
      candidateWebsites: [],
      pdfs,
      overrideUsed: true,
    };
    return success;
  }

  const { companyName: name, candidates } = await getCandidateWebsites(safeTicker);
  const company = name || companyName;

  if (candidates.length === 0) {
    const fallback: PresentationsFallback = {
      ok: false,
      companyName: company,
      ticker: safeTicker,
      message: "Could not confidently identify the official company website. No candidates from search. Set SERPER_API_KEY and try again, or enter a manual override below.",
      candidateWebsites: [],
    };
    return fallback;
  }

  const selection = await selectWebsiteAndIr(company, safeTicker, candidates);
  if (!selection) {
    const fallback: PresentationsFallback = {
      ok: false,
      companyName: company,
      ticker: safeTicker,
      message: "Could not confidently identify the official company website. Claude selection failed or ANTHROPIC_API_KEY is not set.",
      candidateWebsites: candidates.map((c) => c.url),
    };
    return fallback;
  }

  const officialWebsite = selection.officialWebsite;
  const irPage = selection.investorRelationsPage;
  const candidateWebsites = selection.candidateWebsites.length > 0 ? selection.candidateWebsites : candidates.map((c) => c.url);

  if (!officialWebsite) {
    const fallback: PresentationsFallback = {
      ok: false,
      companyName: company,
      ticker: safeTicker,
      message: "Could not confidently identify the official company website.",
      candidateWebsites,
    };
    return fallback;
  }

  const pdfsRaw = await crawlOfficialSiteAndExtractPdfs(officialWebsite, irPage);
  const forRanking = pdfsRaw.map((p) => ({ ...p }));
  const ranked = await rankPdfs(forRanking);
  const pdfs: PdfLink[] = (ranked ?? pdfsRaw.map((p) => ({ ...p, classification: "Other PDF" as const }))).map(
    (p) => ({
      url: p.url,
      title: p.title,
      sourcePage: p.sourcePage,
      date: p.date,
      classification: p.classification,
    })
  );

  const success: PresentationsSuccess = {
    ok: true,
    companyName: company,
    ticker: safeTicker,
    officialWebsite,
    irPage,
    confidence: selection.confidence,
    notes: selection.notes,
    candidateWebsites,
    pdfs,
    overrideUsed: false,
  };
  return success;
}
