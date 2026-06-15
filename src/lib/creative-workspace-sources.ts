/**
 * Creative Work Product tabs (Literary / Biblical / Shorting at 50c / Next Quarter Earnings Transcript):
 * ingest saved Work Product section outputs plus Period Financials earnings transcripts from Saved Documents.
 */

import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import {
  isPeriodFinancialsEarningsTranscriptFilename,
  isWorkspaceSpreadsheetFilename,
} from "@/lib/kpi-workspace-sources";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { listAllUserSavedDocumentsBodiesForIngest, listUserTickerDocuments } from "@/lib/user-workspace-store";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
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

export type CreativeWorkspacePromptKind = "literary" | "biblical" | "dumbass" | "earnings-transcript";

/** Source gather kind — `other-memos` shares one corpus across all four memo prompts. */
export type CreativeWorkspaceSourceKind = CreativeWorkspacePromptKind | "other-memos";

/** @deprecated Use {@link CreativeWorkspacePromptKind} or {@link CreativeWorkspaceSourceKind}. */
export type CreativeWorkspaceKind = CreativeWorkspaceSourceKind;

const WORK_PRODUCT_SECTION_MD_BASE_KEYS = [
  "kpi-latest",
  "forensic-accounting-latest",
  "lme-analysis",
  "cs-recommendation-latest",
  "literary-references-latest",
  "biblical-references-latest",
  "how-to-look-like-a-dumbass-latest",
  "next-quarter-earnings-transcript-latest",
] as const;

function workProductSectionMainDataKeys(): Set<string> {
  const keys = new Set<string>([...WORK_PRODUCT_SECTION_MD_BASE_KEYS, "ai-credit-deck"]);
  for (const k of Object.keys(SAVED_DATA_FILES)) {
    if (k.startsWith("ai-credit-memo-") && !k.endsWith("-meta") && !k.endsWith("-source-pack")) {
      keys.add(k);
    }
  }
  return keys;
}

const OTHER_MEMOS_SHARED_SELF_EXCLUDE = new Set([
  "literary-references-latest",
  "literary-references-latest-meta",
  "literary-references-latest-source-pack",
  "biblical-references-latest",
  "biblical-references-latest-meta",
  "biblical-references-latest-source-pack",
  "how-to-look-like-a-dumbass-latest",
  "how-to-look-like-a-dumbass-latest-meta",
  "how-to-look-like-a-dumbass-latest-source-pack",
  "next-quarter-earnings-transcript-latest",
  "next-quarter-earnings-transcript-latest-meta",
  "next-quarter-earnings-transcript-latest-source-pack",
]);

const SELF_TAB_EXCLUDE_BY_KIND: Record<CreativeWorkspacePromptKind, Set<string>> = {
  literary: new Set([
    "literary-references-latest",
    "literary-references-latest-meta",
    "literary-references-latest-source-pack",
  ]),
  biblical: new Set([
    "biblical-references-latest",
    "biblical-references-latest-meta",
    "biblical-references-latest-source-pack",
  ]),
  dumbass: new Set([
    "how-to-look-like-a-dumbass-latest",
    "how-to-look-like-a-dumbass-latest-meta",
    "how-to-look-like-a-dumbass-latest-source-pack",
  ]),
  "earnings-transcript": new Set([
    "next-quarter-earnings-transcript-latest",
    "next-quarter-earnings-transcript-latest-meta",
    "next-quarter-earnings-transcript-latest-source-pack",
  ]),
};

function selfExcludeKeysForSourceKind(kind: CreativeWorkspaceSourceKind): Set<string> {
  if (kind === "other-memos") return OTHER_MEMOS_SHARED_SELF_EXCLUDE;
  return SELF_TAB_EXCLUDE_BY_KIND[kind];
}

function includeWorkProductSavedTab(kind: CreativeWorkspaceSourceKind, dataKey: string, filename: string): boolean {
  if (selfExcludeKeysForSourceKind(kind).has(dataKey)) return false;
  if (dataKey.endsWith("-meta") || dataKey.endsWith("-source-pack")) return false;
  if (!workProductSectionMainDataKeys().has(dataKey)) return false;
  const fn = filename.trim().toLowerCase();
  return fn.endsWith(".md") || fn.endsWith(".txt");
}

let creativeDocCounter = 0;
function nextCreativeDocId(): string {
  creativeDocCounter += 1;
  return `creative-${creativeDocCounter.toString(36)}`;
}

export async function collectCreativeWorkspaceRawDocuments(
  kind: CreativeWorkspaceSourceKind,
  ticker: string,
  userId?: string | null
): Promise<LmeRawDocument[]> {
  creativeDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;

  const push = (d: Omit<LmeRawDocument, "docId" | "seq"> & { docId?: string }) => {
    out.push({
      docId: d.docId ?? nextCreativeDocId(),
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
    if (!includeWorkProductSavedTab(kind, row.dataKey, fn)) continue;
    const tier = tierForExtractedBody(fn, raw);
    push({
      tier,
      label: `Work Product — ${fn}`,
      key: row.dataKey,
      file: fn,
      raw,
    });
  }

  const maxBytes = loadCreditMemoConfig().maxIngestFileBytes;
  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  for (const { filename, body } of savedDocs) {
    const fn = filename.trim();
    if (!fn) continue;
    if (body.length > maxBytes) continue;
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
    if (!isPeriodFinancialsEarningsTranscriptFilename(fn)) continue;
    try {
      const extracted = (await extractBytesForAi(fn, body)).trim();
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

export function buildCreativeWorkspaceInventory(parts: LmeSourcePart[]): string {
  return parts
    .filter((p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary"))
    .map((p) => {
      const name = p.file ?? p.label;
      const trunc = p.truncated ? ", truncated" : "";
      return `- ${name}${p.key ? ` [key:${p.key}]` : ""} (${p.charsInitial} chars${trunc})`;
    })
    .join("\n");
}

export function buildCreativeWorkspaceMaterials(parts: LmeSourcePart[]): string {
  return parts
    .filter((p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary"))
    .map(
      (p) =>
        `<<<BEGIN SOURCE: ${p.file ?? p.label}${p.key ? ` [key:${p.key}]` : ""} | synthetic>>>\n${p.content}\n<<<END SOURCE: ${p.file ?? p.label}>>>`
    )
    .join("\n\n");
}

export async function gatherCreativeWorkspaceSources(
  kind: CreativeWorkspaceSourceKind,
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
  const rawDocs = await collectCreativeWorkspaceRawDocuments(kind, ticker, userId);
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
    useRetrieval: opts?.useRetrieval === true,
    apiKeys: opts?.apiKeys,
    inventoryOnly: opts?.inventoryOnly === true,
    globalChunkPackTask:
      opts?.useRetrieval === true && opts?.inventoryOnly !== true ? "creative" : undefined,
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
    (p) => p.content.trim().length > 0 && !p.content.startsWith("[Binary")
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
