import "server-only";

import { randomUUID } from "node:crypto";
import type { TradePublication } from "./industry-source-map";
import { lookupPublicationNameByDomain, resolveTradePublications } from "./industry-source-map";
import {
  CUSTOM_INDUSTRY_PUBLICATIONS_PATH,
  MAX_CUSTOM_INDUSTRY_PUBLICATIONS,
} from "./custom-publications-constants";
import { workspaceDeleteFile, workspaceReadFile, workspaceWriteFile } from "@/lib/user-ticker-workspace-store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export { CUSTOM_INDUSTRY_PUBLICATIONS_PATH, MAX_CUSTOM_INDUSTRY_PUBLICATIONS };

export type CustomIndustryPublication = {
  id: string;
  url: string;
  siteDomain: string;
  name: string;
};

type StoredCustomPublications = {
  v: 1;
  publications: CustomIndustryPublication[];
};

export function parsePublicationUrl(input: string): { url: string; siteDomain: string; name: string } | null {
  const raw = input.trim();
  if (!raw) return null;

  let href = raw;
  if (!/^https?:\/\//i.test(href)) {
    href = `https://${href}`;
  }

  try {
    const u = new URL(href);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let host = u.hostname.toLowerCase();
    if (!host || !host.includes(".")) return null;
    if (host.startsWith("www.")) host = host.slice(4);
    const name = lookupPublicationNameByDomain(host);
    return {
      url: u.origin,
      siteDomain: host,
      name,
    };
  } catch {
    return null;
  }
}

function normalizeStoredPublications(raw: unknown): CustomIndustryPublication[] {
  if (!raw || typeof raw !== "object") return [];
  const pubs = (raw as StoredCustomPublications).publications;
  if (!Array.isArray(pubs)) return [];
  const out: CustomIndustryPublication[] = [];
  const seen = new Set<string>();
  for (const row of pubs) {
    if (!row || typeof row !== "object") continue;
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const siteDomain = typeof row.siteDomain === "string" ? row.siteDomain.trim().toLowerCase() : "";
    if (!url || !siteDomain || seen.has(siteDomain)) continue;
    seen.add(siteDomain);
    out.push({
      id: typeof row.id === "string" && row.id.trim() ? row.id : randomUUID(),
      url,
      siteDomain,
      name:
        typeof row.name === "string" && row.name.trim()
          ? row.name.trim()
          : lookupPublicationNameByDomain(siteDomain),
    });
    if (out.length >= MAX_CUSTOM_INDUSTRY_PUBLICATIONS) break;
  }
  return out;
}

export async function readCustomIndustryPublicationsState(
  userId: string,
  ticker: string
): Promise<CustomIndustryPublicationsState> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { state: "unset", publications: [] };
  const buf = await workspaceReadFile(userId, sym, CUSTOM_INDUSTRY_PUBLICATIONS_PATH);
  if (!buf?.length) return { state: "unset", publications: [] };
  try {
    const parsed = JSON.parse(buf.toString("utf8")) as unknown;
    const publications = normalizeStoredPublications(parsed);
    if (publications.length === 0) return { state: "empty", publications: [] };
    return { state: "custom", publications };
  } catch {
    return { state: "unset", publications: [] };
  }
}

export async function readCustomIndustryPublications(
  userId: string,
  ticker: string
): Promise<CustomIndustryPublication[]> {
  const stored = await readCustomIndustryPublicationsState(userId, ticker);
  return stored.publications;
}

export async function writeCustomIndustryPublications(
  userId: string,
  ticker: string,
  publications: CustomIndustryPublication[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };

  const normalized = normalizeStoredPublications({ v: 1, publications });
  const payload: StoredCustomPublications = { v: 1, publications: normalized };
  const res = await workspaceWriteFile(
    userId,
    sym,
    CUSTOM_INDUSTRY_PUBLICATIONS_PATH,
    Buffer.from(JSON.stringify(payload, null, 2), "utf8")
  );
  return res.ok ? { ok: true } : res;
}

export async function resetCustomIndustryPublicationsToAuto(
  userId: string,
  ticker: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return { ok: false, error: "Invalid ticker" };
  await workspaceDeleteFile(userId, sym, CUSTOM_INDUSTRY_PUBLICATIONS_PATH);
  return { ok: true };
}

export type IndustryPublicationMode = "auto" | "custom" | "none";

export type CustomIndustryPublicationsState =
  | { state: "unset"; publications: CustomIndustryPublication[] }
  | { state: "empty"; publications: [] }
  | { state: "custom"; publications: CustomIndustryPublication[] };

export type IndustryPublicationResolution = {
  publications: TradePublication[];
  mode: IndustryPublicationMode;
  customPublications: CustomIndustryPublication[];
  autoPublications: TradePublication[];
};

export async function resolveIndustryPublicationsForDigest(params: {
  userId?: string;
  ticker: string;
  companyName: string;
  sicRaw: string;
  sicDescription: string;
  formerNames?: string[];
}): Promise<IndustryPublicationResolution> {
  const autoPublications = resolveTradePublications(
    params.ticker,
    params.companyName,
    params.sicRaw,
    params.sicDescription,
    params.formerNames
  );

  if (!params.userId) {
    return {
      publications: autoPublications,
      mode: "auto",
      customPublications: [],
      autoPublications,
    };
  }

  const stored = await readCustomIndustryPublicationsState(params.userId, params.ticker);
  if (stored.state === "unset") {
    return {
      publications: autoPublications,
      mode: "auto",
      customPublications: [],
      autoPublications,
    };
  }

  if (stored.state === "empty") {
    return {
      publications: [],
      mode: "none",
      customPublications: [],
      autoPublications,
    };
  }

  const publications: TradePublication[] = stored.publications.map((c) => ({
    id: c.id,
    name: c.name,
    siteDomain: c.siteDomain,
  }));

  return {
    publications,
    mode: "custom",
    customPublications: stored.publications,
    autoPublications,
  };
}

export function customPublicationInputsFromUrls(
  urls: Array<{ url: string; name?: string | null }>
): CustomIndustryPublication[] {
  const out: CustomIndustryPublication[] = [];
  const seen = new Set<string>();
  for (const row of urls) {
    const parsed = parsePublicationUrl(row.url);
    if (!parsed || seen.has(parsed.siteDomain)) continue;
    seen.add(parsed.siteDomain);
    out.push({
      id: randomUUID(),
      url: parsed.url,
      siteDomain: parsed.siteDomain,
      name: row.name?.trim() || parsed.name,
    });
    if (out.length >= MAX_CUSTOM_INDUSTRY_PUBLICATIONS) break;
  }
  return out;
}
