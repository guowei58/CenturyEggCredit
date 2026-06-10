import { detectPresentationFileType } from "../extract-links";
import { parseFiscalPeriodToken } from "../period";
import { prominentForeignTickerInTitle, tickerMatchesDocument } from "../validate";
import type { PresentationDiscoveryInput, RawPresentationLink } from "../types";

type SerperOrganic = { link?: string; title?: string; snippet?: string };

const TRANSCRIPT_EXCLUDE_RE =
  /\bearnings\s+call\b|\bconference\s+call\b|\btranscript\b|\bcall\s+transcript\b/i;

function isTranscriptSearchHit(title: string, url: string, snippet: string): boolean {
  return TRANSCRIPT_EXCLUDE_RE.test(`${title} ${url} ${snippet}`);
}

function scoreSearchHit(title: string, url: string, snippet: string, period: string): { score: number; evidence: string[] } {
  const hay = `${title} ${url} ${snippet}`.toLowerCase();
  let score = 15;
  const evidence: string[] = ["web_search"];
  if (/presentation|investor presentation|earnings deck|slide deck/.test(hay)) {
    score += 20;
    evidence.push("presentation_in_search");
  }
  if (/\.pdf|\.pptx?/.test(url)) score += 10;
  const fp = parseFiscalPeriodToken(period);
  if (fp) {
    const quarterRe = new RegExp(`\\bq${fp.quarter}\\b|${fp.quarter}q`, "i");
    const yearRe = new RegExp(`\\b${fp.year}\\b`);
    if (quarterRe.test(hay) && yearRe.test(hay)) {
      score += 18;
      evidence.push("period_in_search_hit");
    } else if (quarterRe.test(hay)) {
      score += 8;
      evidence.push("quarter_in_search_hit");
    }
  }
  return { score, evidence };
}

/** Serper search for period-specific investor presentation PDFs. */
export async function discoverWebSearchPresentations(
  input: PresentationDiscoveryInput
): Promise<RawPresentationLink[]> {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) return [];

  const fp = parseFiscalPeriodToken(input.period);
  const periodLabel = fp?.label ?? input.period;
  const queries = [
    `${input.companyName} ${input.ticker} ${periodLabel} investor presentation filetype:pdf`,
    `${input.companyName} ${periodLabel} earnings presentation pdf`,
    `${input.ticker} ${periodLabel} investor presentation`,
  ];

  const results: RawPresentationLink[] = [];
  const seen = new Set<string>();

  for (const q of queries) {
    try {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": key, "Content-Type": "application/json" },
        body: JSON.stringify({ q, num: 8 }),
        signal: AbortSignal.timeout(12_000),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { organic?: SerperOrganic[] };
      const organic = Array.isArray(data.organic) ? data.organic : [];
      for (const hit of organic) {
        const url = typeof hit.link === "string" ? hit.link.trim() : "";
        if (!url.startsWith("http")) continue;
        const file_type = detectPresentationFileType(url);
        if (!file_type) continue;
        const keyUrl = url.toLowerCase();
        if (seen.has(keyUrl)) continue;
        seen.add(keyUrl);
        const title = (hit.title ?? url).trim();
        const snippet = (hit.snippet ?? "").trim();
        if (isTranscriptSearchHit(title, url, snippet)) continue;
        if (prominentForeignTickerInTitle(title, input.ticker)) continue;
        const hay = `${title} ${url} ${snippet}`;
        const hasTicker = tickerMatchesDocument(input.ticker, title, url, snippet);
        const companyNeedle = input.companyName
          .toLowerCase()
          .replace(/[^\w\s]/g, " ")
          .split(/\s+/)
          .filter((t) => t.length > 4 && !/^(inc|corp|corporation|company|digital|global)$/i.test(t))[0];
        const hasCompanyToken = companyNeedle ? new RegExp(`\\b${companyNeedle}\\b`, "i").test(hay) : false;
        if (!hasTicker && !hasCompanyToken) continue;
        const { score, evidence } = scoreSearchHit(title, url, snippet, input.period);
        results.push({
          url,
          title,
          source_page_url: url,
          source_type: "web_search",
          file_type,
          document_date: null,
          pre_score: score,
          evidence,
        });
      }
    } catch {
      /* skip query */
    }
  }

  return results.sort((a, b) => b.pre_score - a.pre_score);
}
