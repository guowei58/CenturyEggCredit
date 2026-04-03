import { isAmbiguousTicker } from "@/lib/xSearch/utils";
import type { RedditSearchProfile } from "./types";
import { uniq } from "./utils";

const FINANCE_SUFFIXES = [
  "bonds",
  "bankruptcy",
  "restructuring",
  "debt",
  "credit",
  "Chapter 11",
  "distressed",
  "covenant",
  "earnings",
];

export function buildSearchProfile(params: {
  ticker?: string;
  companyName?: string;
  aliases?: string[];
  selectedSubreddits?: string[];
  defaultSubreddits: string[];
  timeRange: RedditSearchProfile["timeRange"];
  sortMode: RedditSearchProfile["sortMode"];
  sitewideOnly?: boolean;
  subredditOnly?: boolean;
  maxSubs: number;
  maxQueryVariants: number;
}): { profile: RedditSearchProfile; error?: string } {
  const ticker = (params.ticker ?? "").trim().toUpperCase();
  const companyName = (params.companyName ?? "").trim();
  const aliases = uniq((params.aliases ?? []).map((a) => a.trim()).filter((a) => a.length >= 2)).slice(0, 12);

  if (!ticker && !companyName) {
    return {
      profile: {
        ticker: "",
        companyName: "",
        aliases: [],
        selectedSubreddits: [],
        timeRange: params.timeRange,
        sortMode: params.sortMode,
        queries: [],
        ambiguousTicker: false,
      },
      error: "Provide a ticker and/or company name",
    };
  }

  const userSubs = (params.selectedSubreddits ?? []).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const selectedSubreddits = userSubs.length > 0 ? uniq(userSubs) : params.defaultSubreddits.slice(0, params.maxSubs);

  const ambiguousTicker = ticker ? isAmbiguousTicker(ticker) : false;

  const queries: string[] = [];
  if (ticker) queries.push(ticker, `"${ticker}"`);
  if (companyName) queries.push(`"${companyName}"`, companyName);
  for (const a of aliases.slice(0, 6)) {
    if (a.length >= 3) queries.push(`"${a}"`, a);
  }
  if (ticker && companyName) queries.push(`"${companyName}" ${ticker}`, `"${companyName}" OR ${ticker}`);

  for (const suf of FINANCE_SUFFIXES) {
    if (companyName && companyName.length >= 3) queries.push(`"${companyName}" ${suf}`);
    for (const a of aliases.slice(0, 2)) {
      if (a.length >= 3) queries.push(`"${a}" ${suf}`);
    }
  }

  if (ambiguousTicker && companyName) {
    queries.push(`"${companyName}"`);
    queries.unshift(`"${companyName}"`); // boost
  }

  const out = uniq(queries.map((q) => q.replace(/\s+/g, " ").trim())).filter(Boolean);
  const limited = out.slice(0, params.maxQueryVariants);

  return {
    profile: {
      ticker,
      companyName,
      aliases,
      selectedSubreddits,
      timeRange: params.timeRange,
      sortMode: params.sortMode,
      queries: limited,
      ambiguousTicker,
    },
  };
}
