/**
 * Capital-structure **Recommendation** tab corpus: full materialized workspace + all saved tab bodies + all Saved
 * Documents, excluding **Excel only**. Explicitly **includes** generated work product from **LME analysis**, **KPI
 * commentary**, and **Forensic analysis** (e.g. `lme-analysis.md`, `kpi-latest.md`, `forensic-accounting-latest.md`) when
 * present. Still skips app-internal paths (`credit-memo/` caches, memo deck library export tree, embedding vector JSON
 * trees) and this tab’s own `cs-recommendation-latest*` artifacts to avoid self-feed loops.
 */

import { prisma } from "@/lib/prisma";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { MEMO_DECK_LIBRARY_PATH_PREFIX } from "@/lib/creditMemo/workProductIngestScope";
import { isWorkspaceEmbeddingVectorCachePath, isWorkspaceSpreadsheetFilename } from "@/lib/kpi-workspace-sources";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { listUserTickerDocuments, listAllUserSavedDocumentsBodiesForIngest } from "@/lib/user-workspace-store";
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

let csRecDocCounter = 0;
function nextCsRecDocId(): string {
  csRecDocCounter += 1;
  return `csrec-${csRecDocCounter.toString(36)}`;
}

const CS_REC_SELF_TAB_KEYS = new Set([
  "cs-recommendation-latest",
  "cs-recommendation-latest-meta",
  "cs-recommendation-latest-source-pack",
]);

function isCsRecSelfWorkspaceBasename(base: string): boolean {
  return /^cs-recommendation-latest/i.test(base.trim());
}

function isInternalWorkspaceOnlyPath(rel: string): boolean {
  const n = rel.replace(/\\/g, "/").replace(/^\/+/, "").toLowerCase();
  if (n === "credit-memo" || n.startsWith("credit-memo/")) return true;
  if (n.startsWith(MEMO_DECK_LIBRARY_PATH_PREFIX.toLowerCase())) return true;
  const base = (n.split("/").pop() ?? n).toLowerCase();
  if (base === "ai-credit-deck.txt") return true;
  return false;
}

export async function collectCsRecommendationRawDocuments(ticker: string, userId?: string | null): Promise<LmeRawDocument[]> {
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

  const maxBytes = loadCreditMemoConfig().maxIngestFileBytes;

  const rows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true, body: true },
    orderBy: { path: "asc" },
  });

  for (const row of rows) {
    const rel = row.path.replace(/\\/g, "/");
    const base = rel.split("/").pop() ?? rel;
    if (isWorkspaceSpreadsheetFilename(base)) continue;
    if (isWorkspaceEmbeddingVectorCachePath(rel)) continue;
    if (isInternalWorkspaceOnlyPath(rel)) continue;
    if (isCsRecSelfWorkspaceBasename(base)) continue;
    const buf = Buffer.from(row.body);
    if (buf.length > maxBytes) continue;
    try {
      const extracted = (await extractBytesForAi(base, buf)).trim();
      if (!extracted) continue;
      const tier = tierForExtractedBody(base, extracted);
      push({
        tier,
        label: `Workspace — ${rel}`,
        file: rel,
        raw: extracted,
      });
    } catch {
      /* skip */
    }
  }

  const tabRows = await listUserTickerDocuments(userId, sym);
  for (const row of tabRows) {
    if (!(row.dataKey in SAVED_DATA_FILES)) continue;
    if (CS_REC_SELF_TAB_KEYS.has(row.dataKey)) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
    if (isCsRecSelfWorkspaceBasename(fn)) continue;
    const tier = tierForExtractedBody(fn, raw);
    push({
      tier,
      label: `Saved tab — ${fn}`,
      key: row.dataKey,
      file: fn,
      raw,
    });
  }

  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  for (const { filename, body } of savedDocs) {
    const fn = filename.trim();
    if (!fn) continue;
    if (body.length > maxBytes) continue;
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
    const base = fn.split("/").pop() ?? fn;
    if (isCsRecSelfWorkspaceBasename(base)) continue;
    if (isInternalWorkspaceOnlyPath(fn)) continue;
    try {
      const extracted = (await extractBytesForAi(base, body)).trim();
      if (!extracted) continue;
      const tier = tierForExtractedBody(fn, extracted);
      push({
        tier,
        label: `Saved Documents — ${fn}`,
        file: fn,
        raw: extracted,
      });
    } catch {
      /* skip */
    }
  }

  return out.sort((a, b) => a.tier - b.tier || a.seq - b.seq);
}

export function formatSourcesForCsRecommendation(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header =
    `Ticker: ${sym}\n` +
    `The blocks below are packed from your full ticker workspace plus all saved tab bodies and Saved Documents (Excel spreadsheets excluded). ` +
    `Generated outputs from **LME analysis**, **KPI commentary**, and **Forensic analysis** are included when saved to the workspace or tabs. ` +
    `Embedding-vector caches under \`credit-memo/\` and this tab’s own prior \`cs-recommendation-latest*\` files are excluded. ` +
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
  opts?: { apiKeys?: LlmCallApiKeys; useRetrieval?: boolean; inventoryOnly?: boolean }
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
  const rawDocs = await collectCsRecommendationRawDocuments(ticker, userId);
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
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
