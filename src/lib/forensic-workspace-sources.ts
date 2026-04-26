/**
 * Forensic Analysis corpus: materialized user ticker workspace + saved tab bodies + Saved Documents,
 * excluding (1) the same sources as **LME Analysis** (LME workspace subtrees, LME tab keys, and Saved Documents that pass
 * the LME include gate), (2) Excel spreadsheets (.xls/.xlsx/.xlsm/.xlsb), (3) generated work products, (4) embedding
 * vector caches under `credit-memo/lme-retrieval-embeddings` and `credit-memo/kpi-embeddings`, and (5) paths excluded by
 * `workspaceFileSkippedForWorkProductIngest(..., "forensic")`.
 */

import { prisma } from "@/lib/prisma";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { workspaceFileSkippedForWorkProductIngest } from "@/lib/creditMemo/workProductIngestScope";
import {
  generatedWorkProductTabDataKeys,
  isUnderLmeAnalysisWorkspacePath,
  isWorkspaceEmbeddingVectorCachePath,
  isWorkspaceSpreadsheetFilename,
  lmeAnalysisTabDataKeys,
  lmeAnalysisTabMaterializedFilenamesLower,
  workspaceGeneratedArtifactBasenamesLower,
} from "@/lib/kpi-workspace-sources";
import { userSavedDocumentIncludedInLmeCorpus } from "@/lib/lme-saved-documents-filter";
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

let forensicDocCounter = 0;
function nextForensicDocId(): string {
  forensicDocCounter += 1;
  return `forensic-ws-${forensicDocCounter.toString(36)}`;
}

export async function collectForensicWorkspaceRawDocuments(ticker: string, userId?: string | null): Promise<LmeRawDocument[]> {
  forensicDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;
  const workProductBasenames = workspaceGeneratedArtifactBasenamesLower();
  const workProductTabKeys = generatedWorkProductTabDataKeys();
  const lmeTabKeys = lmeAnalysisTabDataKeys();
  const lmeTabBasenamesLower = lmeAnalysisTabMaterializedFilenamesLower();

  const push = (d: Omit<LmeRawDocument, "docId" | "seq"> & { docId?: string }) => {
    out.push({
      docId: d.docId ?? nextForensicDocId(),
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
    if (workProductBasenames.has(base.toLowerCase())) continue;
    if (isUnderLmeAnalysisWorkspacePath(rel)) continue;
    if (lmeTabBasenamesLower.has(base.toLowerCase())) continue;
    const wp = workspaceFileSkippedForWorkProductIngest(rel, "forensic");
    if (wp.skip) continue;
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
    if (workProductTabKeys.has(row.dataKey)) continue;
    if (lmeTabKeys.has(row.dataKey)) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
    if (workProductBasenames.has(fn.trim().toLowerCase())) continue;
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
    if (workProductBasenames.has(base.toLowerCase())) continue;
    const wp = workspaceFileSkippedForWorkProductIngest(fn, "forensic");
    if (wp.skip) continue;
    if (userSavedDocumentIncludedInLmeCorpus(fn, body.length).ok) continue;
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

export async function gatherForensicWorkspaceSources(
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
  const rawDocs = await collectForensicWorkspaceRawDocuments(ticker, userId);
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
    useRetrieval: opts?.useRetrieval === true,
    apiKeys: opts?.apiKeys,
    inventoryOnly: opts?.inventoryOnly === true,
    globalChunkPackTask:
      opts?.useRetrieval === true && opts?.inventoryOnly !== true ? "forensic" : undefined,
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
