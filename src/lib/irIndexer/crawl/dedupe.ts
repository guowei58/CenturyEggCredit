import type { IrAsset } from "../types";

export function dedupeAssets<T extends { normalized_url: string }>(assets: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const a of assets) {
    const k = (a.normalized_url ?? "").trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function dedupePages(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const k = u.trim().toLowerCase();
    if (!k) continue;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

