import { buildArchivesFileUrl, fetchFilingIndexItems } from "@/lib/sec/filingIndex";
import { getAllFilingsByCik, rankEarningsAdjacent8KFilings, type SecFiling } from "@/lib/sec-edgar";
import type { PresentationDiscoveryInput, RawPresentationLink } from "../types";
import { detectPresentationFileType } from "../extract-links";
import { parseFiscalPeriodToken } from "../period";

const PRESENTATION_KEYWORDS = [
  "presentation",
  "investor presentation",
  "earnings presentation",
  "quarterly results",
  "financial results",
  "earnings",
  "slide",
  "deck",
  "results",
];

function scoreExhibitFilename(name: string, typeField?: string, period?: string | null): { score: number; evidence: string[] } {
  const hay = `${name} ${typeField ?? ""} ${period ?? ""}`.toLowerCase();
  let score = 20;
  const evidence: string[] = ["sec_exhibit"];
  for (const kw of PRESENTATION_KEYWORDS) {
    if (hay.includes(kw)) {
      score += kw.includes("presentation") ? 18 : 10;
      evidence.push(`keyword:${kw}`);
    }
  }
  if (/ex-99/i.test(typeField ?? "") || /ex99/i.test(name)) {
    score += 12;
    evidence.push("ex-99_exhibit");
  }
  if (/\.pdf$/i.test(name)) score += 8;
  if (/\.pptx?$/i.test(name)) score += 6;
  if (period) {
    const fp = parseFiscalPeriodToken(period);
    if (fp) {
      const qPat = new RegExp(`q${fp.quarter}|${fp.quarter}q|${fp.year}`, "i");
      if (qPat.test(hay)) {
        score += 15;
        evidence.push("period_token_in_filename");
      }
    }
  }
  return { score, evidence };
}

function filingFormsNearEarnings(filings: SecFiling[], anchorDate: string): SecFiling[] {
  const eightK = rankEarningsAdjacent8KFilings(
    filings.filter((f) => f.form?.trim().toUpperCase() === "8-K"),
    anchorDate,
    { maxDaysBefore: 5, maxDaysAfter: 21, anchorIsPeriodEnd: true }
  );
  const sixK = filings
    .filter((f) => f.form?.trim().toUpperCase() === "6-K")
    .filter((f) => {
      const fd = f.filingDate?.slice(0, 10) ?? "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fd) || !/^\d{4}-\d{2}-\d{2}$/.test(anchorDate)) return false;
      const diff = Math.abs(new Date(fd).getTime() - new Date(anchorDate).getTime()) / 86_400_000;
      return diff <= 21;
    })
    .sort((a, b) => (b.filingDate ?? "").localeCompare(a.filingDate ?? ""));
  const seen = new Set<string>();
  const merged: SecFiling[] = [];
  for (const f of [...eightK, ...sixK]) {
    const k = f.accessionNumber;
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(f);
  }
  return merged.slice(0, 8);
}

/** Find PDF/PPT exhibits on nearby 8-K / 6-K filings (complements HTML slide-deck extraction). */
export async function discoverSecPresentationExhibits(
  input: PresentationDiscoveryInput,
  anchorDate: string
): Promise<RawPresentationLink[]> {
  const paddedCik = input.cik.replace(/\D/g, "").padStart(10, "0");
  const cikNum = parseInt(paddedCik, 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return [];

  const subs = await getAllFilingsByCik(paddedCik, {
    includeForms: ["8-K", "6-K"],
    maxFilings: 400,
    paceChunkMs: 80,
  });
  if (!subs?.filings?.length) return [];

  const targetFilings = filingFormsNearEarnings(subs.filings, anchorDate);
  const results: RawPresentationLink[] = [];
  const seenUrl = new Set<string>();

  for (const filing of targetFilings) {
    const items = await fetchFilingIndexItems(paddedCik, filing.accessionNumber);
    for (const item of items) {
      const name = item.name ?? "";
      const file_type = detectPresentationFileType(name);
      if (!file_type) continue;
      const url = buildArchivesFileUrl(cikNum, filing.accessionNumber, name);
      if (seenUrl.has(url)) continue;
      seenUrl.add(url);
      const { score, evidence } = scoreExhibitFilename(name, item.type, input.period);
      results.push({
        url,
        title: name,
        source_page_url: filing.docUrl ?? url,
        source_type: "sec_exhibit",
        file_type,
        document_date: filing.filingDate?.slice(0, 10) ?? null,
        pre_score: score,
        evidence,
      });
    }
  }

  return results.sort((a, b) => b.pre_score - a.pre_score);
}
