import { getCompanyProfile, getFilingsByTicker, type SecFiling } from "@/lib/sec-edgar";
import { dedupeHashFor, dedupeNewsItems } from "./dedupe";
import { formatNyDateKey, isWithinRollingHours } from "./dates";
import { resolveTradePublications } from "./industry-source-map";
import { fetchGoogleNewsSearch } from "./rss";
import { classifyOutletFromUrl } from "./classify-source";
import type { DailyNewsBatchPayload, DailyNewsItem, DailyNewsTickerBlock } from "./types";

const MATERIAL_FORMS = new Set([
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
]);

function watchlistSignature(tickers: string[]): string {
  return [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))].sort().join("|");
}

const CORP_STOPWORDS = new Set([
  "inc",
  "corp",
  "corporation",
  "company",
  "co",
  "plc",
  "ltd",
  "limited",
  "the",
  "and",
  "group",
  "holding",
  "holdings",
  "llc",
  "lp",
  "sa",
  "nv",
  "ag",
  "se",
  "bv",
  "group",
]);

function significantNameTokens(companyName: string): string[] {
  const raw = companyName
    .replace(/[.,']/g, " ")
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);
  return raw.filter((w) => w.length >= 2 && !CORP_STOPWORDS.has(w));
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Prefer matching the **company legal name** (significant tokens). Use the ticker only as a
 * word-boundary supplement so short symbols (e.g. NN) do not match arbitrary substrings.
 */
function articleMatchesWatchlist(
  textBlob: string,
  ticker: string,
  companyName: string,
  mode: "company" | "industry"
): boolean {
  const b = textBlob.toLowerCase();
  const tk = ticker.trim().toUpperCase();
  const cn = companyName.trim();
  const placeholderName = !cn || cn.toUpperCase() === tk;

  if (!placeholderName) {
    const minTok = mode === "company" ? 4 : 3;
    const tokens = significantNameTokens(cn);
    if (tokens.some((t) => t.length >= minTok && b.includes(t))) return true;
    const hits3 = tokens.filter((t) => t.length >= 3 && b.includes(t));
    if (hits3.length >= 2) return true;
  }

  if (tk.length >= 2) {
    try {
      if (new RegExp(`\\b${escapeRegex(tk)}\\b`, "i").test(textBlob)) return true;
    } catch {
      /* fall through */
    }
  }
  if (tk.length > 0) {
    return b.includes(`$${tk.toLowerCase()}`);
  }
  return false;
}

function filingToItem(ticker: string, companyName: string, f: SecFiling): DailyNewsItem {
  const headline = `${f.form}: ${f.description || f.primaryDocument || "Filing"}`;
  const summary = `${f.form} filed ${f.filingDate}. ${f.description ? f.description.slice(0, 280) : "See filing for details."}`;
  const why =
    f.form === "8-K"
      ? "Current report — often material events or updates investors should review."
      : ["10-K", "10-Q", "20-F", "6-K"].includes(f.form)
        ? "Periodic financial disclosure — compare to your model and covenants."
        : ["DEF 14A", "PRE 14A"].includes(f.form)
          ? "Proxy / governance — executive comp, votes, and key proposals."
          : ["S-1", "S-3", "F-1", "424B"].some((x) => f.form.startsWith(x))
            ? "Securities offering / registration — capital structure and dilution risk."
            : "Regulatory filing — verify facts against your thesis.";

  const url = f.docUrl;
  return {
    dedupeHash: dedupeHashFor(headline, url),
    ticker,
    source: "SEC EDGAR",
    sourceType: "SEC",
    headline,
    url,
    publishedAt: f.filingDate,
    summary,
    whyItMatters: why,
  };
}

function rssToItems(
  ticker: string,
  companyName: string,
  articles: { title: string; link: string; pubDate: string; description?: string }[],
  windowEnd: Date,
  mode: "company" | "industry"
): DailyNewsItem[] {
  const out: DailyNewsItem[] = [];
  const tk = ticker.toUpperCase();
  for (const a of articles) {
    let dateStr: string;
    try {
      dateStr = new Date(a.pubDate).toISOString().slice(0, 10);
    } catch {
      continue;
    }
    if (!isWithinRollingHours(dateStr, windowEnd, 26)) continue;
    const { source, sourceType } = classifyOutletFromUrl(a.link);
    const textBlob = `${a.title}\n${a.description ?? ""}\n${a.link}`;
    if (!articleMatchesWatchlist(textBlob, ticker, companyName, mode)) continue;

    out.push({
      dedupeHash: dedupeHashFor(a.title, a.link),
      ticker: tk,
      source,
      sourceType,
      headline: a.title.replace(/ - .*$/, "").slice(0, 300),
      url: a.link,
      publishedAt: dateStr,
      summary: a.title.slice(0, 400),
      whyItMatters:
        sourceType === "SEC"
          ? "Primary disclosure source."
          : "Check relevance — headline match does not guarantee materiality.",
    });
  }
  return out;
}

async function safeFetchGoogle(q: string, errors: Array<{ source: string; message: string }>, label: string) {
  try {
    return await fetchGoogleNewsSearch(q, 12);
  } catch (e) {
    errors.push({ source: label, message: e instanceof Error ? e.message : String(e) });
    return [];
  }
}

/**
 * Build one daily batch payload for the given watchlist tickers.
 */
export async function buildDailyNewsPayload(
  tickers: string[],
  windowEnd: Date
): Promise<{ batchDateKey: string; payload: DailyNewsBatchPayload; watchlistSignature: string }> {
  const uniq = [...new Set(tickers.map((t) => t.trim().toUpperCase()).filter(Boolean))];
  const sig = watchlistSignature(uniq);
  const fetchErrors: Array<{ source: string; message: string }> = [];
  const sourcesUsed = new Set<string>();
  const summaryByTicker: Record<string, DailyNewsTickerBlock> = {};
  const topBullets: string[] = [];

  for (const ticker of uniq) {
    let companyName = ticker;
    let sic = "";
    let sicDescription = "";
    let formerNames: string[] = [];
    try {
      const profile = await getCompanyProfile(ticker);
      if (profile) {
        companyName = profile.name;
        sic = profile.sic;
        sicDescription = profile.sicDescription;
        formerNames = profile.formerNames;
      }
    } catch (e) {
      fetchErrors.push({ source: `profile:${ticker}`, message: e instanceof Error ? e.message : String(e) });
    }

    const trades = resolveTradePublications(ticker, companyName, sic, sicDescription, formerNames);
    trades.forEach((t) => sourcesUsed.add(`trade:${t.siteDomain}`));

    let secItems: DailyNewsItem[] = [];
    try {
      const filingsPack = await getFilingsByTicker(ticker);
      if (filingsPack?.filings?.length) {
        const recent = filingsPack.filings.filter(
          (f) =>
            isWithinRollingHours(f.filingDate, windowEnd, 24) &&
            (MATERIAL_FORMS.has(f.form) || f.form.startsWith("424"))
        );
        secItems = recent.map((f) => filingToItem(ticker, companyName, f));
        sourcesUsed.add("SEC EDGAR");
      }
    } catch (e) {
      fetchErrors.push({ source: `sec:${ticker}`, message: e instanceof Error ? e.message : String(e) });
    }

    const majorQ = `(${ticker} OR "${companyName.replace(/"/g, "")}") (site:wsj.com OR site:ft.com OR site:bloomberg.com) when:1d`;
    const majorArts = await safeFetchGoogle(majorQ, fetchErrors, `major:${ticker}`);
    sourcesUsed.add("Google News (WSJ/FT/Bloomberg)");

    const companyRss = rssToItems(ticker, companyName, majorArts, windowEnd, "company");

    const industryArts: typeof majorArts = [];
    for (const tr of trades) {
      const q = `site:${tr.siteDomain} (${ticker} OR "${companyName.split(" ")[0] ?? ""}") when:1d`;
      industryArts.push(...(await safeFetchGoogle(q, fetchErrors, `trade:${tr.id}`)));
    }
    const industryRss = rssToItems(ticker, companyName, industryArts, windowEnd, "industry");

    const companyNews = dedupeNewsItems([...companyRss]);
    const industryNews = dedupeNewsItems([...industryRss]);
    const secFilings = dedupeNewsItems(secItems);

    const why =
      secFilings.length > 0
        ? `Latest SEC activity (${secFilings.map((s) => s.headline.split(":")[0]).join(", ")}) should be reconciled to your model.`
        : companyNews.length + industryNews.length > 0
          ? "News flow present — verify materiality vs. your catalyst list and liquidity view."
          : "No major items in the last 24h in automated sweep — confirm manually if needed.";

    summaryByTicker[ticker] = {
      ticker,
      companyName,
      newSinceLastUpdate: [],
      industryPublications: trades.map((t) => ({ id: t.id, name: t.name, siteDomain: t.siteDomain })),
      companyNews,
      industryNews,
      secFilings,
      whyItMatters: why,
    };

    const first =
      secFilings[0]?.headline ||
      companyNews[0]?.headline ||
      industryNews[0]?.headline ||
      `${ticker}: no notable automated hits in the last 24h.`;
    topBullets.push(`${ticker}: ${first}`);
  }

  const generatedAt = windowEnd.toISOString();
  const batchDateKey = formatNyDateKey(windowEnd);

  const payload: DailyNewsBatchPayload = {
    v: 1,
    generatedAt,
    latestRefreshAt: generatedAt,
    tickers: uniq,
    watchlistSignature: sig,
    topLevelSummary:
      topBullets.length > 0
        ? `Today's biggest developments across the watchlist:\n${topBullets.map((b) => `• ${b}`).join("\n")}`
        : "No automated highlights for this window — check SEC and major outlets manually.",
    summaryByTicker,
    sourcesUsed: Array.from(sourcesUsed),
    fetchErrors,
  };

  return { batchDateKey, payload, watchlistSignature: sig };
}

export function signatureForTickers(tickers: string[]): string {
  return watchlistSignature(tickers);
}

export { watchlistSignature };
