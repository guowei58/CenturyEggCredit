import { getAllFilingsByCik, getCompanyProfile } from "@/lib/sec-edgar";
import { discoverLiveIrPresentations } from "./adapters/live-ir";
import { discoverQ4IrPresentations } from "./adapters/q4-ir";
import { discoverSecPresentationExhibits } from "./adapters/sec";
import { discoverWaybackPresentations } from "./adapters/wayback";
import { discoverWebSearchPresentations } from "./adapters/web-search";
import { parseFiscalPeriodToken, resolveDiscoveryAnchorDate } from "./period";
import { pickBestCandidate } from "./score";
import { savePresentationDiscoveryDocument } from "./storage";
import type {
  PresentationDiscoveryInput,
  PresentationDiscoveryMetadata,
  PresentationDiscoveryResult,
  PresentationSourceType,
  RawPresentationLink,
} from "./types";
import { validatePresentationCandidate } from "./validate";

const MAX_VALIDATE = 8;

function dedupeRawLinks(links: RawPresentationLink[]): RawPresentationLink[] {
  const byUrl = new Map<string, RawPresentationLink>();
  for (const link of links) {
    const key = link.url.toLowerCase();
    const prev = byUrl.get(key);
    if (!prev || link.pre_score > prev.pre_score) byUrl.set(key, link);
  }
  return Array.from(byUrl.values()).sort((a, b) => b.pre_score - a.pre_score);
}

export async function discoverManagementPresentation(
  input: PresentationDiscoveryInput,
  opts?: { userId?: string | null; save?: boolean }
): Promise<PresentationDiscoveryResult> {
  const ticker = input.ticker.trim().toUpperCase();
  const fp = parseFiscalPeriodToken(input.period);
  const periodLabel = fp?.label ?? input.period.trim();

  let cik = input.cik.replace(/\D/g, "").padStart(10, "0");
  let companyName = input.companyName.trim();
  if (!companyName || cik === "0000000000") {
    const profile = await getCompanyProfile(ticker);
    if (profile?.cik) cik = profile.cik.replace(/\D/g, "").padStart(10, "0");
    if (profile?.name) companyName = profile.name;
  }
  if (!companyName) companyName = ticker;

  const normalizedInput: PresentationDiscoveryInput = {
    ...input,
    ticker,
    cik,
    companyName,
    period: periodLabel,
  };

  const anchorDate = resolveDiscoveryAnchorDate({
    earningsDate: input.earningsDate,
    reportDate: input.reportDate,
    period: periodLabel,
  });

  const adapterCounts: Record<PresentationSourceType, number> = {
    sec_exhibit: 0,
    live_ir: 0,
    q4_ir: 0,
    wayback: 0,
    web_search: 0,
  };

  const q4Links = await discoverQ4IrPresentations(normalizedInput);
  adapterCounts.q4_ir = q4Links.length;

  const validated: Awaited<ReturnType<typeof validatePresentationCandidate>>[] = [];
  for (const raw of q4Links.slice(0, 3)) {
    validated.push(await validatePresentationCandidate(normalizedInput, raw));
  }

  let best = pickBestCandidate(validated);
  let merged = [...q4Links];
  let liveIr = { links: [] as RawPresentationLink[], irDomains: [] as string[], cdnDomains: [] as string[] };

  if (!best || best.review_status === "reject") {
    const [secLinks, liveIrResult, webSearchLinks] = await Promise.all([
      discoverSecPresentationExhibits(normalizedInput, anchorDate),
      discoverLiveIrPresentations(normalizedInput, { anchorDate, irDomains: [], cdnDomains: [] }),
      discoverWebSearchPresentations(normalizedInput),
    ]);
    liveIr = liveIrResult;
    adapterCounts.sec_exhibit = secLinks.length;
    adapterCounts.live_ir = liveIr.links.length;
    adapterCounts.web_search = webSearchLinks.length;

    const irSeeds = liveIr.links.slice(0, 5).map((l) => l.source_page_url);
    const waybackLinks = await discoverWaybackPresentations(irSeeds, periodLabel, anchorDate, {
      anchorDate,
      irDomains: liveIr.irDomains,
      cdnDomains: liveIr.cdnDomains,
    });
    adapterCounts.wayback = waybackLinks.length;

    merged = dedupeRawLinks([...q4Links, ...secLinks, ...liveIr.links, ...waybackLinks, ...webSearchLinks]);
    const seen = new Set(validated.map((v) => v.url.toLowerCase()));
    for (const raw of merged.slice(0, MAX_VALIDATE)) {
      if (seen.has(raw.url.toLowerCase())) continue;
      validated.push(await validatePresentationCandidate(normalizedInput, raw));
    }
    best = pickBestCandidate(validated);
  }

  const metadata: PresentationDiscoveryMetadata = {
    discoveredAt: new Date().toISOString(),
    input: normalizedInput,
    candidatesConsidered: merged.length,
    candidatesValidated: validated.length,
    allCandidates: validated,
    irDomains: liveIr.irDomains,
    adapterCounts,
  };

  if (!best) {
    return { ok: false, best: null, metadata, error: "No presentation candidates found" };
  }

  let savedDocument: PresentationDiscoveryResult["savedDocument"];
  const shouldSave = opts?.save !== false && opts?.userId && best.review_status !== "reject";
  if (shouldSave && opts.userId) {
    const saved = await savePresentationDiscoveryDocument(opts.userId, ticker, best);
    if (saved.ok) {
      savedDocument = { filename: saved.filename, openUrl: saved.openUrl, bytes: saved.bytes };
    }
  }

  return {
    ok: best.review_status !== "reject" || validated.every((c) => c.review_status === "reject"),
    best,
    metadata,
    savedDocument,
  };
}

/** Resolve CIK from ticker when caller only supplies ticker + period. */
export async function resolveDiscoveryInputFromTicker(
  ticker: string,
  period: string,
  extras?: { earningsDate?: string | null; reportDate?: string | null; companyName?: string; cik?: string }
): Promise<PresentationDiscoveryInput | null> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return null;
  const profile = await getCompanyProfile(tk);
  const subs = profile?.cik ? await getAllFilingsByCik(profile.cik, { maxFilings: 1 }) : null;
  return {
    ticker: tk,
    cik: extras?.cik?.replace(/\D/g, "").padStart(10, "0") ?? profile?.cik ?? subs?.cik ?? "",
    companyName: extras?.companyName?.trim() || profile?.name || subs?.companyName || tk,
    period,
    earningsDate: extras?.earningsDate,
    reportDate: extras?.reportDate,
  };
}
