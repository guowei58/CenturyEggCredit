import {
  filingPeriodLabelToRoicPeriod,
  periodLabelToFilenameSlug,
} from "@/lib/period-financials-roic";
import {
  fetchRoicV2EarningsCallTranscript,
  getRoicTranscriptIdentifierCandidates,
  parseRoicQuarterPeriod,
} from "@/lib/roic-ai";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { upsertUserSavedDocument } from "@/lib/user-workspace-store";

export async function fetchRoicEarningsTranscriptText(
  ticker: string,
  roicPeriod: string,
  roicSymbolOverride?: string | null
): Promise<{ ok: true; text: string; roicSymbol: string } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const parsed = parseRoicQuarterPeriod(roicPeriod);
  if (!parsed) {
    return { ok: false, error: `Invalid Roic quarter period: ${roicPeriod}` };
  }

  const identifiers = getRoicTranscriptIdentifierCandidates(sym, roicSymbolOverride);
  if (identifiers.length === 0) {
    return { ok: false, error: "No company identifier to query." };
  }

  const errors: string[] = [];
  for (const id of identifiers) {
    const r = await fetchRoicV2EarningsCallTranscript(id, parsed.year, parsed.quarter);
    if (r.ok) {
      return { ok: true, text: r.content, roicSymbol: r.symbol };
    }
    errors.push(`${id}: ${r.error}`);
  }

  return {
    ok: false,
    error:
      errors[errors.length - 1] ??
      `No transcript returned for ${roicPeriod}.`,
  };
}

export async function saveRoicEarningsTranscriptForPeriod(
  userId: string,
  ticker: string,
  opts: {
    periodLabel: string;
    roicPeriod?: string | null;
    reportDate?: string | null;
    filingDate?: string | null;
    /** Roic quote symbol override (e.g. GEL US); falls back to ROIC_AI_SYMBOL_OVERRIDE. */
    roicSymbol?: string | null;
    /** SEC period end from ixbrl-mdna bundle — preferred over filing.reportDate (matches Period Financials tab). */
    ixbrlReportDate?: string | null;
  }
): Promise<{ ok: true; filename: string } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const reportDate = opts.ixbrlReportDate ?? opts.reportDate ?? null;
  const roicPeriod =
    opts.roicPeriod?.trim() ||
    filingPeriodLabelToRoicPeriod(opts.periodLabel, reportDate, opts.filingDate);
  if (!roicPeriod) {
    return { ok: false, error: `Could not map period label "${opts.periodLabel}" to a Roic quarter.` };
  }

  const fetched = await fetchRoicEarningsTranscriptText(sym, roicPeriod, opts.roicSymbol);
  if (!fetched.ok) return fetched;

  const slug = periodLabelToFilenameSlug(opts.periodLabel);
  const filename = `${sym}_earnings-transcript_${slug}.txt`;
  const title = `${sym} earnings transcript · ${opts.periodLabel}`;
  const sourceUrl = `https://www.roic.ai/quote/${encodeURIComponent(sym)}/transcripts/${roicPeriod.slice(0, 4)}/${roicPeriod.slice(-1)}`;
  const header = `Source: ROIC.AI earnings-calls API (${roicPeriod}, symbol ${fetched.roicSymbol})\nPeriod label: ${opts.periodLabel}\nSaved: ${new Date().toISOString()}\n\n---\n\n`;
  const body = Buffer.from(header + fetched.text.slice(0, 2_000_000), "utf8");

  const saved = await upsertUserSavedDocument(userId, sym, {
    filename,
    title,
    originalUrl: sourceUrl,
    contentType: "text/plain; charset=utf-8",
    body,
    savedAtIso: new Date().toISOString(),
    convertedToPdf: false,
  });
  if (!saved.ok) return { ok: false, error: saved.error };

  return { ok: true, filename };
}
