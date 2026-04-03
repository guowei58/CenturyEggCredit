import type { ConfidenceBucket, ResearchProfile, ResearchProviderId } from "./types";
import { isAmbiguousTicker } from "@/lib/xSearch/utils";

const RESEARCH_RE = /(research|report|analysis|note|insight|outlook|webinar|podcast|transcript|presentation|distress|restructur|covenant|credit|high\s+yield|leveraged|default|maturity|refinanc|bankrupt|chapter\s+11)/i;

function has(re: RegExp, s: string): boolean {
  return re.test(s);
}

export function scoreMatch(args: {
  provider: ResearchProviderId;
  profile: ResearchProfile;
  title: string;
  snippet: string;
  url: string;
  excerpt: string;
  importantPathBoost: boolean;
  accessLevel: "public" | "partially_gated" | "gated";
  pageType: string;
}): { score: number; bucket: ConfidenceBucket; reasons: string[]; matchedAlias: string | null } {
  const tk = args.profile.ticker;
  const name = args.profile.companyName ?? "";
  const aliases = args.profile.aliases;

  const blobTitle = args.title.toLowerCase();
  const blob = `${args.title}\n${args.snippet}\n${args.excerpt}`.toLowerCase();

  let s = 0;
  const reasons: string[] = [];
  let matchedAlias: string | null = null;

  if (tk && blobTitle.includes(tk.toLowerCase())) {
    s += 35;
    reasons.push("ticker_in_title");
  } else if (tk && blob.includes(tk.toLowerCase())) {
    s += 16;
    reasons.push("ticker_in_text");
  }

  if (name && name.length >= 3 && blobTitle.includes(name.toLowerCase())) {
    s += 32;
    reasons.push("company_in_title");
  } else if (name && name.length >= 3 && blob.includes(name.toLowerCase())) {
    s += 18;
    reasons.push("company_in_text");
  }

  for (const a of aliases) {
    const al = a.toLowerCase();
    if (al.length < 3) continue;
    if (blobTitle.includes(al)) {
      s += 18;
      matchedAlias = matchedAlias ?? a;
      reasons.push(`alias_in_title:${a}`);
      break;
    }
  }

  if (has(RESEARCH_RE, args.title) || has(RESEARCH_RE, args.snippet) || has(RESEARCH_RE, args.excerpt)) {
    s += 14;
    reasons.push("research_keywords");
  }

  if (args.importantPathBoost) {
    s += 16;
    reasons.push("important_path");
  }

  if (args.provider === "wsj_bankruptcy") {
    if (/\/pro\/bankruptcy|\/news\/types\/pro-bankruptcy-bankruptcy/i.test(args.url)) {
      s += 18;
      reasons.push("wsj_bankruptcy_path");
    }
  }

  if (args.pageType === "generic_page") s -= 18;
  if (/(login|signup|trial|careers|privacy|terms|about)/i.test(args.url)) s -= 30;

  if (args.accessLevel === "gated") {
    s -= 6;
    reasons.push("gated_or_metadata_only");
  } else if (args.accessLevel === "partially_gated") {
    s -= 2;
    reasons.push("partially_gated");
  }

  // Ambiguity penalty
  if (tk && isAmbiguousTicker(tk) && !reasons.includes("company_in_title") && !reasons.includes("company_in_text")) {
    s -= 14;
    reasons.push("ambiguous_ticker_penalty");
  }

  // Bucket
  let bucket: ConfidenceBucket = "low";
  if (s >= 70) bucket = "high";
  else if (s >= 45) bucket = "medium";

  return { score: s, bucket, reasons, matchedAlias };
}

