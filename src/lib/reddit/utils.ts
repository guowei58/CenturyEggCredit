import { createHash } from "crypto";

export function nowIso(): string {
  return new Date().toISOString();
}

export function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 24);
}

export function uniq(xs: string[]): string[] {
  return Array.from(new Set(xs));
}

export function cacheFingerprint(profile: {
  ticker: string;
  companyName: string;
  aliases: string[];
  subs: string[];
  time: string;
  sort: string;
  sitewideOnly: boolean;
  subredditOnly: boolean;
}): string {
  return stableId([
    profile.ticker,
    profile.companyName,
    profile.aliases.join(","),
    profile.subs.join(","),
    profile.time,
    profile.sort,
    String(profile.sitewideOnly),
    String(profile.subredditOnly),
  ]);
}
