/**
 * List files in an SEC filing folder via Archives index.json.
 */

import { getSecEdgarUserAgent } from "@/lib/sec-edgar";

export type SecFilingIndexItem = { name: string; type?: string; size?: string };

function normalizeIndexItems(data: unknown): SecFilingIndexItem[] {
  if (!data || typeof data !== "object") return [];
  const dir = (data as Record<string, unknown>).directory;
  if (!dir || typeof dir !== "object") return [];
  const item = (dir as Record<string, unknown>).item;
  if (Array.isArray(item)) return item.filter((x) => x && typeof x === "object") as SecFilingIndexItem[];
  if (item && typeof item === "object") return [item as SecFilingIndexItem];
  return [];
}

export async function fetchFilingIndexItems(cikPadded: string, accessionNumber: string): Promise<SecFilingIndexItem[]> {
  const cikNum = parseInt(cikPadded.replace(/\D/g, ""), 10);
  if (!Number.isFinite(cikNum) || cikNum <= 0) return [];
  const accNoDashes = accessionNumber.replace(/-/g, "");
  if (accNoDashes.length < 10) return [];

  const indexUrl = `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/index.json`;
  let res: Response;
  try {
    res = await fetch(indexUrl, { headers: { "User-Agent": getSecEdgarUserAgent() } });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return [];
  }
  return normalizeIndexItems(data)
    .map((i) => ({ ...i, name: (i.name ?? "").trim() }))
    .filter((i) => i.name.length > 0);
}

export function buildArchivesFileUrl(cikNum: number, accessionDashed: string, filename: string): string {
  const accNoDashes = accessionDashed.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikNum}/${accNoDashes}/${filename}`;
}
