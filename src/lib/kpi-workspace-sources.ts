/**
 * KPI Commentary source pack: Saved Documents only, limited to Period Financials
 * management presentations and earnings transcripts. This keeps the KPI tab focused
 * on the curated investor materials the user explicitly saved from Period Financials.
 */

import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { CREDIT_AGREEMENTS_SAVED_KEYS } from "@/lib/covenant-sources";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { listAllUserSavedDocumentsBodiesForIngest } from "@/lib/user-workspace-store";
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

/** App-internal embedding caches (vector JSON — not research text). Sync with `lme-retrieval.ts` / `kpiRetrieval.ts` STORAGE_PREFIX. */
const INTERNAL_EMBEDDING_WORKSPACE_PREFIXES = [
  "credit-memo/lme-retrieval-embeddings/",
  "credit-memo/kpi-embeddings/",
] as const;

/** Workspace subtrees that supply the LME Analysis tab corpus (same paths LME reads from). */
const LME_WORKSPACE_PATH_PREFIXES = [
  "Credit Agreements & Indentures/",
  "Capital Structure Excel/",
  "Org Chart Excel/",
  "Subsidiary List Excel/",
] as const;

/** Spreadsheet extensions excluded from KPI / Forensic broad workspace ingest. */
export function isWorkspaceSpreadsheetFilename(name: string): boolean {
  return /\.(xlsx?|xlsm|xlsb)$/i.test(name.trim());
}

/** True when `relPath` is under a folder LME Analysis ingests from the materialized workspace. */
export function isUnderLmeAnalysisWorkspacePath(relPath: string): boolean {
  const n = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return LME_WORKSPACE_PATH_PREFIXES.some((p) => n.startsWith(p));
}

/** Saved-tab keys whose text is part of the LME Analysis ingest set. */
function lmeTabDataKeys(): Set<string> {
  const s = new Set<string>(["capital-structure", "org-chart-prompt", "subsidiary-list"]);
  for (const { key } of CREDIT_AGREEMENTS_SAVED_KEYS) s.add(key);
  return s;
}

/** Same as {@link lmeTabDataKeys} — exported for Forensic (exclude LME tab duplicates). */
export function lmeAnalysisTabDataKeys(): Set<string> {
  return lmeTabDataKeys();
}

/** Lowercase basenames of `SAVED_DATA_FILES` entries for LME Analysis tabs (skip duplicate workspace rows). */
export function lmeAnalysisTabMaterializedFilenamesLower(): Set<string> {
  const s = new Set<string>();
  for (const k of lmeTabDataKeys()) {
    const fn = SAVED_DATA_FILES[k as keyof typeof SAVED_DATA_FILES];
    if (typeof fn === "string" && fn.trim()) s.add(fn.trim().toLowerCase());
  }
  return s;
}

/** Saved-tab keys for generated work: LME, forensic, CS recommendation, AI memos/deck, KPI tab, etc. */
function buildWorkProductSavedKeys(): Set<string> {
  const s = new Set<string>([
    "lme-analysis",
    "lme-analysis-meta",
    "forensic-accounting-latest",
    "forensic-accounting-latest-meta",
    "forensic-accounting-latest-source-pack",
    "cs-recommendation-latest",
    "cs-recommendation-latest-meta",
    "cs-recommendation-latest-source-pack",
    "entity-mapper-latest",
    "entity-mapper-latest-meta",
    "entity-mapper-v2-snapshot",
    "ai-credit-deck",
    "kpi-latest",
    "kpi-latest-meta",
    "kpi-latest-source-pack",
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
    "credit-decision-dashboard-latest",
    "credit-decision-dashboard-latest-meta",
    "credit-decision-dashboard-latest-source-pack",
    "credit-decision-dashboard-inputs",
    "xbrl-deterministic-compiler-result",
  ]);
  for (const k of Object.keys(SAVED_DATA_FILES)) {
    if (k.startsWith("ai-credit-memo-")) s.add(k);
  }
  return s;
}

/** Basenames (lowercase) of generated tab artifacts on disk — skip for KPI / Forensic workspace rows. */
export function workspaceGeneratedArtifactBasenamesLower(): Set<string> {
  const out = new Set<string>();
  for (const k of buildWorkProductSavedKeys()) {
    const fn = SAVED_DATA_FILES[k as keyof typeof SAVED_DATA_FILES];
    if (typeof fn === "string" && fn.trim()) out.add(fn.trim().toLowerCase());
  }
  return out;
}

/** Postgres `dataKey` values for generated outputs — skip for KPI / Forensic saved-tab ingest. */
export function generatedWorkProductTabDataKeys(): Set<string> {
  return buildWorkProductSavedKeys();
}

/** Vector-cache paths under the user workspace — not research text. */
export function isWorkspaceEmbeddingVectorCachePath(relPath: string): boolean {
  const n = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  return INTERNAL_EMBEDDING_WORKSPACE_PREFIXES.some((p) => n.startsWith(p));
}

function isKpiPeriodFinancialsMgmtPresentationFilename(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return n.includes("_mgmt-presentation_") || n.includes("-mgmt-presentation.");
}

function isKpiPeriodFinancialsEarningsTranscriptFilename(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  return n.includes("_earnings-transcript_") || n.includes("roic-earnings-transcript-");
}

/** Period Financials management presentation saved to Saved Documents. */
export function isPeriodFinancialsMgmtPresentationFilename(name: string): boolean {
  return isKpiPeriodFinancialsMgmtPresentationFilename(name);
}

/** Period Financials earnings transcript saved to Saved Documents. */
export function isPeriodFinancialsEarningsTranscriptFilename(name: string): boolean {
  return isKpiPeriodFinancialsEarningsTranscriptFilename(name);
}

function isKpiPeriodFinancialsSourceFilename(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  if (n.endsWith(".meta.json")) return false;
  return (
    isKpiPeriodFinancialsMgmtPresentationFilename(n) || isKpiPeriodFinancialsEarningsTranscriptFilename(n)
  );
}

let kpiDocCounter = 0;
function nextKpiDocId(): string {
  kpiDocCounter += 1;
  return `kpi-${kpiDocCounter.toString(36)}`;
}

/**
 * Raw documents for KPI: Saved Documents containing Period Financials management
 * presentations or earnings transcripts.
 * Requires `userId` for anything beyond an empty list.
 */
export async function collectKpiCommentaryRawDocuments(ticker: string, userId?: string | null): Promise<LmeRawDocument[]> {
  kpiDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;

  const push = (d: Omit<LmeRawDocument, "docId" | "seq"> & { docId?: string }) => {
    out.push({
      docId: d.docId ?? nextKpiDocId(),
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

  const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
  for (const { filename, body } of savedDocs) {
    const fn = filename.trim();
    if (!fn) continue;
    if (body.length > maxBytes) continue;
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
    if (!isKpiPeriodFinancialsSourceFilename(fn)) continue;
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

export function formatSourcesForKpiCommentary(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header = `Ticker: ${sym}\nThe blocks below are Saved Documents only, limited to management presentations and earnings transcripts saved from Period Financials. Ask users to save at least one management presentation or earnings transcript in Period Financials before running KPI commentary. When retrieval is enabled, you usually receive one embedding-ranked context pack from this corpus under the character ceiling; otherwise you receive ordinary per-source blocks. Use them as the primary factual basis for KPI commentary.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

export async function gatherKpiCommentarySources(
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
}> {
  const rawDocs = await collectKpiCommentaryRawDocuments(ticker, userId);
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
    useRetrieval: opts?.useRetrieval === true,
    apiKeys: opts?.apiKeys,
    inventoryOnly: opts?.inventoryOnly === true,
    globalChunkPackTask:
      opts?.useRetrieval === true && opts?.inventoryOnly !== true ? "kpi" : undefined,
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
  };
}
