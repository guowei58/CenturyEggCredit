/**
 * KPI Commentary source pack: full user ticker workspace + saved tabs + saved documents,
 * excluding (1) LME Analysis ingest, (2) generated work products (LME / forensic / recommendation /
 * AI memos & deck / KPI / literary / biblical tab outputs) and the `ai-memo-deck-library/` archive
 * (saved memos/decks from the library), (3) LME/KPI embedding vector caches under `credit-memo/`, (4) selected
 * research tabs (earnings releases, presentations & transcripts, industry/employee contacts), and (5) all Excel files.
 */

import { prisma } from "@/lib/prisma";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { CREDIT_AGREEMENTS_SAVED_KEYS } from "@/lib/covenant-sources";
import { listUserTickerDocuments, listAllUserSavedDocumentsBodiesForIngest } from "@/lib/user-workspace-store";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { userSavedDocumentIncludedInLmeCorpus } from "@/lib/lme-saved-documents-filter";
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
import { isMemoDeckLibraryWorkspacePath } from "@/lib/creditMemo/workProductIngestScope";

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
    /** Deterministic XBRL compiler dump (JSON) — restores Financials tab; not KPI source text. */
    "xbrl-deterministic-compiler-result",
  ]);
  for (const k of Object.keys(SAVED_DATA_FILES)) {
    if (k.startsWith("ai-credit-memo-")) s.add(k);
  }
  return s;
}

/** Materialized filenames for those keys (workspace basename match). */
function buildWorkProductFilenamesLower(): Set<string> {
  const out = new Set<string>();
  for (const k of buildWorkProductSavedKeys()) {
    const fn = SAVED_DATA_FILES[k as keyof typeof SAVED_DATA_FILES];
    if (typeof fn === "string" && fn.trim()) out.add(fn.trim().toLowerCase());
  }
  return out;
}

/** Research tabs omitted from KPI commentary (saved Postgres tab text + same-named workspace files). */
const KPI_COMMENTARY_EXCLUDED_TAB_KEYS: readonly string[] = [
  "earnings-releases",
  /** "Mgmt Presentations & Transcripts" tab — `SAVED_DATA_FILES` key is `presentations`. */
  "presentations",
  "industry-contacts",
  "employee-contacts",
];

function kpiCommentaryExcludedFilenamesLower(): Set<string> {
  const out = buildWorkProductFilenamesLower();
  for (const k of KPI_COMMENTARY_EXCLUDED_TAB_KEYS) {
    const fn = SAVED_DATA_FILES[k as keyof typeof SAVED_DATA_FILES];
    if (typeof fn === "string" && fn.trim()) out.add(fn.trim().toLowerCase());
  }
  return out;
}

/** Tab keys to omit from KPI: LME research inputs + generated work products + selected research tabs. */
function kpiExcludedTabDataKeys(): Set<string> {
  const s = lmeTabDataKeys();
  for (const k of buildWorkProductSavedKeys()) s.add(k);
  for (const k of KPI_COMMENTARY_EXCLUDED_TAB_KEYS) s.add(k);
  return s;
}

/** Spreadsheet extensions excluded from KPI / Forensic broad workspace ingest. */
export function isWorkspaceSpreadsheetFilename(name: string): boolean {
  return /\.(xlsx?|xlsm|xlsb)$/i.test(name.trim());
}

/** Basenames (lowercase) of generated tab artifacts on disk — skip for KPI / Forensic workspace rows. */
export function workspaceGeneratedArtifactBasenamesLower(): Set<string> {
  return buildWorkProductFilenamesLower();
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

let kpiDocCounter = 0;
function nextKpiDocId(): string {
  kpiDocCounter += 1;
  return `kpi-${kpiDocCounter.toString(36)}`;
}

/**
 * Raw documents for KPI: workspace files + non-LME tab saves + saved documents not in the LME corpus.
 * Requires `userId` for anything beyond an empty list.
 */
export async function collectKpiCommentaryRawDocuments(ticker: string, userId?: string | null): Promise<LmeRawDocument[]> {
  kpiDocCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;
  const excludedTabs = kpiExcludedTabDataKeys();
  const workProductFilenames = kpiCommentaryExcludedFilenamesLower();

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

  const rows = await prisma.userTickerWorkspaceFile.findMany({
    where: { userId, ticker: sym },
    select: { path: true, body: true },
    orderBy: { path: "asc" },
  });

  const maxBytes = loadCreditMemoConfig().maxIngestFileBytes;

  for (const row of rows) {
    const rel = row.path.replace(/\\/g, "/");
    const base = rel.split("/").pop() ?? rel;
    if (isWorkspaceSpreadsheetFilename(base)) continue;
    if (isUnderLmeAnalysisWorkspacePath(rel)) continue;
    if (isWorkspaceEmbeddingVectorCachePath(rel)) continue;
    if (isMemoDeckLibraryWorkspacePath(rel)) continue;
    if (workProductFilenames.has(base.toLowerCase())) continue;
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
    if (excludedTabs.has(row.dataKey)) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    const fn = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    if (isWorkspaceSpreadsheetFilename(fn)) continue;
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
    if (isMemoDeckLibraryWorkspacePath(fn)) continue;
    if (workProductFilenames.has(fn.toLowerCase())) continue;
    const gate = userSavedDocumentIncludedInLmeCorpus(fn, body.length);
    if (gate.ok) continue;
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
  const header = `Ticker: ${sym}\nThe blocks below are your full ticker workspace (uploaded files) plus saved tab text and Saved Documents, excluding (1) sources that feed the LME Analysis tab (capital structure / org chart / subsidiary responses, credit-agreement tab saves and uploads, capital-structure/org/subsidiary Excel trees, and saved documents that pass the LME include gate), (2) generated work products (LME analysis, forensic accounting, capital-structure recommendation, AI credit memos and source packs, AI credit deck, KPI commentary outputs) and the ai-memo-deck-library/ tree (library memos and decks on disk), (3) embedding-vector cache files under credit-memo/lme-retrieval-embeddings and credit-memo/kpi-embeddings, (4) saved tabs and matching workspace files for earnings releases, management presentations & transcripts, industry contacts, and employee contacts, and (5) all Excel spreadsheets (.xls/.xlsx/.xlsm/.xlsb). When retrieval is enabled, you usually receive one embedding-ranked context pack from this corpus under the character ceiling; otherwise you receive ordinary per-source blocks. Use them as the primary factual basis for KPI commentary.\n\n`;
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
