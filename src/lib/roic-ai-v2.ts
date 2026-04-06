/**
 * Roic AI REST v2 fundamentals — server-only.
 * @see https://api.roic.ai/v2/fundamental/…
 */

import { getRoicApiKey } from "@/lib/roic-ai";
import { ROIC_V2_DATASET_TO_PATH, type RoicV2FundamentalDataset } from "@/lib/roic-ai-v2-datasets";

export type { RoicV2FundamentalDataset } from "@/lib/roic-ai-v2-datasets";

export type RoicV2StatementPeriod = "annual" | "quarterly";

export function buildRoicV2FundamentalUrl(
  dataset: RoicV2FundamentalDataset,
  roicSymbol: string,
  apiKey: string,
  statementPeriod: RoicV2StatementPeriod = "annual"
): string {
  const subPath = ROIC_V2_DATASET_TO_PATH[dataset];
  const url = new URL(`https://api.roic.ai/v2/fundamental/${subPath}/${encodeURIComponent(roicSymbol)}`);
  url.searchParams.set("apikey", apiKey);
  if (statementPeriod === "quarterly") {
    url.searchParams.set("period", "quarterly");
  }
  return url.toString();
}

export async function fetchRoicV2FundamentalJson(
  dataset: RoicV2FundamentalDataset,
  roicSymbol: string,
  statementPeriod: RoicV2StatementPeriod = "annual"
): Promise<{ ok: true; data: unknown } | { ok: false; status: number; error: string }> {
  const apiKey = getRoicApiKey();
  if (!apiKey) {
    return { ok: false, status: 503, error: "ROIC_AI_API_KEY is not configured." };
  }

  const url = buildRoicV2FundamentalUrl(dataset, roicSymbol.trim(), apiKey, statementPeriod);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      next: { revalidate: 0 },
    });
    const text = await res.text();
    if (!res.ok) {
      let err = `HTTP ${res.status}`;
      try {
        const j = JSON.parse(text) as { detail?: { error?: string }; error?: string; message?: string };
        err = j.detail?.error ?? j.error ?? j.message ?? err;
      } catch {
        if (text.length > 0 && text.length < 400) err = text;
      }
      return { ok: false, status: res.status, error: err };
    }
    try {
      return { ok: true, data: JSON.parse(text) as unknown };
    } catch {
      return { ok: false, status: 502, error: "Invalid JSON from Roic v2 API" };
    }
  } catch (e) {
    return { ok: false, status: 0, error: e instanceof Error ? e.message : "Request failed" };
  }
}
