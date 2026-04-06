import { createHash } from "crypto";
import fs from "fs/promises";
import path from "path";

import type { EnvRiskSnapshot, FacilityOverridesFile } from "@/lib/env-risk/types";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

function cacheRoot(): string {
  return path.join(process.cwd(), "data", "env-risk-cache");
}

function tickerDirSanitized(sanitizedTicker: string): string {
  return path.join(cacheRoot(), sanitizedTicker);
}

export async function readEnvRiskSnapshot(ticker: string): Promise<EnvRiskSnapshot | null> {
  const t = sanitizeTicker(ticker);
  if (!t) return null;
  const fp = path.join(tickerDirSanitized(t), "snapshot.json");
  try {
    const raw = await fs.readFile(fp, "utf8");
    return JSON.parse(raw) as EnvRiskSnapshot;
  } catch {
    return null;
  }
}

export async function writeEnvRiskSnapshot(ticker: string, snapshot: EnvRiskSnapshot): Promise<void> {
  const t = sanitizeTicker(ticker);
  if (!t) throw new Error("Invalid ticker");
  const dir = tickerDirSanitized(t);
  await fs.mkdir(dir, { recursive: true });
  const fp = path.join(dir, "snapshot.json");
  await fs.writeFile(fp, JSON.stringify(snapshot, null, 2), "utf8");
}

export async function readPreviousSnapshotHash(ticker: string): Promise<string | null> {
  const t = sanitizeTicker(ticker);
  if (!t) return null;
  const fp = path.join(tickerDirSanitized(t), "last-hash.txt");
  try {
    return (await fs.readFile(fp, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

export async function writePreviousSnapshotHash(ticker: string, hash: string): Promise<void> {
  const t = sanitizeTicker(ticker);
  if (!t) return;
  const dir = tickerDirSanitized(t);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "last-hash.txt"), hash, "utf8");
}

export async function readFacilityOverrides(ticker: string): Promise<FacilityOverridesFile> {
  const t = sanitizeTicker(ticker);
  if (!t) return { confirmed_registry_ids: [], rejected_registry_ids: [] };
  const fp = path.join(tickerDirSanitized(t), "facility-overrides.json");
  try {
    const raw = await fs.readFile(fp, "utf8");
    const j = JSON.parse(raw) as FacilityOverridesFile;
    return {
      confirmed_registry_ids: Array.isArray(j.confirmed_registry_ids) ? j.confirmed_registry_ids.map(String) : [],
      rejected_registry_ids: Array.isArray(j.rejected_registry_ids) ? j.rejected_registry_ids.map(String) : [],
    };
  } catch {
    return { confirmed_registry_ids: [], rejected_registry_ids: [] };
  }
}

export async function writeFacilityOverrides(ticker: string, o: FacilityOverridesFile): Promise<void> {
  const t = sanitizeTicker(ticker);
  if (!t) throw new Error("Invalid ticker");
  const dir = tickerDirSanitized(t);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "facility-overrides.json"), JSON.stringify(o, null, 2), "utf8");
}

export function snapshotContentHash(s: EnvRiskSnapshot): string {
  const slim = {
    disclosure_count: s.disclosure_rows.length,
    facilities: s.facilities.map((f) => f.registry_id),
    scores: s.scores,
    filing_hashes: s.filing_summaries.map((f) => f.content_hash),
  };
  return createHash("sha256").update(JSON.stringify(slim)).digest("hex").slice(0, 24);
}
