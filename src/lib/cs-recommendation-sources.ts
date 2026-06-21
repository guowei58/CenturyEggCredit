/**
 * Capital-structure Recommendation corpus: saved tab text files only, plus the
 * generated markdown outputs from LME Analysis, KPI Commentary, and Forensic Analysis.
 */

import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { listUserTickerDocuments } from "@/lib/user-workspace-store";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import {
  packLmeSourcesForModel,
  lmeRawSourcesFingerprint,
  LME_DEFAULT_BUNDLE_CHAR_CAP,
  LME_DEFAULT_PER_PART_CHAR_CAP,
  type GatherLmeLimits,
  type LmeRawDocument,
  type LmeSourcePart,
  type LmeRunPackingStats,
} from "@/lib/lme-sources";
import { collectWorkProductRawDocumentsWithAdditions } from "@/lib/work-product-ingest-additions";
import type { SourceGatherProgressReporter } from "@/lib/work-product-source-progress-reporter";

let csRecDocCounter = 0;
function nextCsRecDocId(): string {
  csRecDocCounter += 1;
  return `csrec-${csRecDocCounter.toString(36)}`;
}

const CS_REC_SELF_TAB_KEYS = new Set([
  "cs-recommendation-latest",
  "cs-recommendation-latest-meta",
  "cs-recommendation-latest-source-pack",
  "entity-mapper-latest",
  "entity-mapper-latest-meta",
  "entity-mapper-v2-snapshot",
]);

const CS_REC_INCLUDED_MD_TAB_KEYS = new Set([
  "lme-analysis",
  "kpi-latest",
  "forensic-accounting-latest",
]);

function includeRecommendationSavedTab(dataKey: string, filename: string): boolean {
  if (CS_REC_SELF_TAB_KEYS.has(dataKey)) return false;
  if (dataKey.endsWith("-source-pack") || dataKey.endsWith("-meta")) return false;
  const fn = filename.trim().toLowerCase();
  if (CS_REC_INCLUDED_MD_TAB_KEYS.has(dataKey) && fn.endsWith(".md")) return true;
  if (fn.endsWith(".txt")) return true;
  return false;
}

export async function collectCsRecommendationRawDocuments(
  ticker: string,
  userId?: string | null,
  _reporter?: SourceGatherProgressReporter
): Promise<LmeRawDocument[]> {
  csRecDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;

  const push = (d: Omit<LmeRawDocument, "docId" | "seq"> & { docId?: string }) => {
    out.push({
      docId: d.docId ?? nextCsRecDocId(),
      seq: seq++,
      tier: d.tier,
      label: d.label,
      key: d.key,
      file: d.file,
      raw: d.raw,
    });
  };

  const sym = sanitizeTicker(ticker);
  if (!userId || !sym) return out.sort((a, b) => a.tier - b.tier || a.seq - b.seq);

  const tabRows = await listUserTickerDocuments(userId, sym);
  for (const row of tabRows) {
    if (!(row.dataKey in SAVED_DATA_FILES)) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    if (!includeRecommendationSavedTab(row.dataKey, fn)) continue;
    const tier = tierForExtractedBody(fn, raw);
    push({
      tier,
      label: `Saved tab — ${fn}`,
      key: row.dataKey,
      file: fn,
      raw,
    });
  }

  return out.sort((a, b) => a.tier - b.tier || a.seq - b.seq);
}

export function formatSourcesForCsRecommendation(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header =
    `Ticker: ${sym}\n` +
    `The blocks below are limited to saved tab text files plus the generated markdown outputs from **LME analysis**, **KPI commentary**, and **Forensic analysis**. ` +
    `Recommendation and Entity Mapper self-outputs are excluded to avoid self-feed loops. ` +
    `When retrieval is enabled, you receive embedding-ranked context under the same catalog-wide ceiling as LME analysis. ` +
    `Use them as the primary factual basis for capital-structure protection conclusions.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

export async function gatherCsRecommendationSources(
  ticker: string,
  limits?: GatherLmeLimits,
  userId?: string | null,
  opts?: { apiKeys?: LlmCallApiKeys; useRetrieval?: boolean; inventoryOnly?: boolean; progressKey?: string }
): Promise<{
  parts: LmeSourcePart[];
  totalChars: number;
  nonEmptyCount: number;
  hasSubstantiveText: boolean;
  retrievalUsed: boolean;
  sourceFingerprint: string;
  packingStats?: LmeRunPackingStats;
  rawDocuments: LmeRawDocument[];
}> {
  const rawDocs = await collectWorkProductRawDocumentsWithAdditions(
    "recommendation",
    ticker,
    userId,
    (reporter) => collectCsRecommendationRawDocuments(ticker, userId, reporter),
    opts?.progressKey
  );
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack, documentRows } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
    useRetrieval: opts?.useRetrieval === true,
    apiKeys: opts?.apiKeys,
    inventoryOnly: opts?.inventoryOnly === true,
    globalChunkPackTask:
      opts?.useRetrieval === true && opts?.inventoryOnly !== true ? "lme" : undefined,
  });

  const bundleCap = limits?.maxTotalChars ?? LME_DEFAULT_BUNDLE_CHAR_CAP;
  const partCap = limits?.maxPartChars ?? LME_DEFAULT_PER_PART_CHAR_CAP;

  const packingStats: LmeRunPackingStats | undefined =
    opts?.inventoryOnly === true
      ? undefined
      : {
          rawSourceCharsSum: rawDocs.reduce((s, d) => s + d.raw.length, 0),
          packedPartsCharSum: parts.reduce((s, p) => s + p.content.length, 0),
          bundleCharCap: bundleCap,
          perPartCharCap: partCap,
          retrievalUsed,
          blocksInPack: parts.length,
          blockRows: parts.map((p) => ({
            label: p.label,
            key: p.key,
            file: p.file,
            charsInitial: p.charsInitial,
            packedChars: p.content.length,
            truncated: p.truncated,
          })),
          documentRows,
          retrievalPack,
        };

  const nonEmptyCount = parts.filter(
    (p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary")
  ).length;
  const hasSubstantiveText = parts.some(
    (p) => p.content.trim().length > 40 && !p.content.startsWith("[Binary")
  );

  return {
    parts,
    totalChars: parts.reduce((s, p) => s + p.content.length, 0),
    nonEmptyCount,
    hasSubstantiveText,
    retrievalUsed,
    sourceFingerprint,
    packingStats,
    rawDocuments: rawDocs,
  };
}
