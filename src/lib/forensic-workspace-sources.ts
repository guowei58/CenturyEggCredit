/**
 * Forensic Analysis corpus: four specific saved tabs plus the latest saved 10-K.
 */

import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { isWorkspaceSpreadsheetFilename } from "@/lib/kpi-workspace-sources";
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
import { collectWorkProductRawDocumentsWithAdditions } from "@/lib/work-product-ingest-additions";
import {
  runExtractLoop,
  type SourceGatherProgressReporter,
} from "@/lib/work-product-source-progress-reporter";

let forensicDocCounter = 0;
function nextForensicDocId(): string {
  forensicDocCounter += 1;
  return `forensic-ws-${forensicDocCounter.toString(36)}`;
}

const FORENSIC_SAVED_TAB_KEYS = [
  "business-model",
  "how-stuff-works",
  "risk-from-10k",
  "business-risk-analysis",
] as const;

function looksLikeTenKFilename(filename: string): boolean {
  return /(^|[_\s-])10-k([_\s.-]|$)/i.test(filename);
}

function extractTenKYear(filename: string): number {
  const m = /10-k[_-](?:fy[_-])?(\d{4})/i.exec(filename);
  return m ? Number(m[1]) : -1;
}

export async function collectForensicWorkspaceRawDocuments(
  ticker: string,
  userId?: string | null,
  reporter?: SourceGatherProgressReporter
): Promise<LmeRawDocument[]> {
  forensicDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;

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

  const tabRows = await listUserTickerDocuments(userId, sym);
  for (const row of tabRows) {
    if (!(row.dataKey in SAVED_DATA_FILES)) continue;
    if (!FORENSIC_SAVED_TAB_KEYS.includes(row.dataKey as (typeof FORENSIC_SAVED_TAB_KEYS)[number])) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    const tier = tierForExtractedBody(fn, raw);
    push({
      tier,
      label: `Saved tab — ${fn}`,
      key: row.dataKey,
      file: fn,
      raw,
    });
  }

  reporter?.({ phase: "loading", detail: "Loading saved document bodies…", done: 0, total: 0 });
  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  const latestTenK = savedDocs
    .map((doc, index) => ({ ...doc, index }))
    .filter(({ filename, body }) => {
      const fn = filename.trim();
      return fn && body.length <= maxBytes && !isWorkspaceSpreadsheetFilename(fn) && looksLikeTenKFilename(fn);
    })
    .sort((a, b) => {
      const yearDelta = extractTenKYear(b.filename) - extractTenKYear(a.filename);
      if (yearDelta !== 0) return yearDelta;
      return a.index - b.index;
    })[0];

  if (latestTenK) {
    await runExtractLoop(reporter, "extracting", [
      {
        label: latestTenK.filename.trim(),
        run: async () => {
          try {
            const fn = latestTenK.filename.trim();
            const base = fn.split("/").pop() ?? fn;
            const extracted = (await extractBytesForAi(base, latestTenK.body)).trim();
            if (!extracted) return;
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
        },
      },
    ]);
  }

  return out.sort((a, b) => a.tier - b.tier || a.seq - b.seq);
}

export async function gatherForensicWorkspaceSources(
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
    "forensic",
    ticker,
    userId,
    (reporter) => collectForensicWorkspaceRawDocuments(ticker, userId, reporter),
    opts?.progressKey
  );
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack, documentRows } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
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
