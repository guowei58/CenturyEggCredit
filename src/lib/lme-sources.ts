/**
 * Aggregate Capital Structure section documents for LME analysis, plus the saved
 * Business Model tab, with optional
 * embedding retrieval for long documents (same embedding stack as KPI).
 */

import path from "path";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { CREDIT_AGREEMENTS_SAVED_KEYS } from "@/lib/covenant-sources";
import { listCreditAgreementsFiles } from "@/lib/credit-agreements-files";
import { workspaceReadFile } from "@/lib/user-ticker-workspace-store";
import { listCapitalStructureExcels, getCapitalStructureExcelBuffer } from "@/lib/capital-structure-excel";
import { listOrgChartExcels, getOrgChartExcelBuffer } from "@/lib/org-chart-excel";
import { listSubsidiaryListExcels, getSubsidiaryListExcelBuffer } from "@/lib/subsidiary-list-excel";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import type { LmeTier } from "@/lib/lme-tier-classify";
import { basenameLower, tierForExtractedBody } from "@/lib/lme-tier-classify";
import { kpiFilenameSuggestsCreditAgreementOrIndenture } from "@/lib/creditMemo/workProductIngestScope";
import { hasAnyKpiEmbeddingKey } from "@/lib/kpi-embedding-provider";
import {
  buildLmeChunksForDocument,
  capLmeChunksPreservingEachDocument,
  embedLmeRetrievalQuery,
  embedRetrievalQueryForTask,
  ensureLmeRetrievalEmbeddings,
  formatRetrievedChunksForPrompt,
  isLmeRetrievalEnabled,
  kpiCreditDocExtraIngestMaxChunksPerDocument,
  kpiExtraIngestMaxChunksPerDocument,
  kpiExtraIngestMaxPartChars,
  lmeFullInlineMaxChars,
  lmeGlobalMaxChunksPerDocument,
  lmeGlobalRankMaxChunks,
  lmeMaxChunksPerDocument,
  retrievalQueryForTask,
  selectLmeChunksForBudget,
  type LmeIndexedChunk,
  type LmeRetrievalPackTask,
} from "@/lib/lme-retrieval";
import { collectWorkProductRawDocumentsWithAdditions } from "@/lib/work-product-ingest-additions";
import {
  runExtractLoop,
  type SourceGatherProgressReporter,
} from "@/lib/work-product-source-progress-reporter";

export type LmeRawDocument = {
  docId: string;
  tier: LmeTier;
  /** Stable ordering within the same tier (collection order). */
  seq: number;
  label: string;
  key?: string;
  file?: string;
  raw: string;
};

export type LmeSourcePart = {
  label: string;
  key?: string;
  file?: string;
  content: string;
  truncated: boolean;
  /** Character length of raw ingested/extracted text before per-part truncation (not counting later bundle trim). */
  charsInitial: number;
};

const LME_SAVED_TAB_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "business-model", label: "Business Model — Saved response" },
  { key: "capital-structure", label: "Capital Structure — Saved response" },
  { key: "org-chart-prompt", label: "Org Chart — Saved response" },
  { key: "subsidiary-list", label: "Subsidiary List — Saved response" },
];

/** Max characters per source block after extraction, before bundle trim (material contracts can exceed this alone). */
export const LME_DEFAULT_PER_PART_CHAR_CAP = 140_000;
const DEFAULT_MAX_PART_CHARS = LME_DEFAULT_PER_PART_CHAR_CAP;
/**
 * Max sum of packed `part.content` lengths sent into `formatSourcesForLme` (server-side LME context budget).
 * Framing lines (`==========`, SOURCE: …) add a little on top; the fixed LME task spec is separate in the user message.
 */
export const LME_DEFAULT_BUNDLE_CHAR_CAP = 400_000;
const DEFAULT_MAX_TOTAL_CHARS = LME_DEFAULT_BUNDLE_CHAR_CAP;
const MAX_RAW_CHARS_FOR_RETRIEVAL = 600_000;

export class LmeRetrievalRequiredError extends Error {
  readonly code = "LME_RETRIEVAL_REQUIRED" as const;

  constructor(message: string) {
    super(message);
    this.name = "LmeRetrievalRequiredError";
  }
}

export const LME_RETRIEVAL_REQUIRED_HINT =
  "Embedding retrieval is required for this Work Product tab but did not run. Add an OpenAI or Gemini API key in Settings (used for embeddings), ensure LME_RETRIEVAL is not disabled, then rebuild the context window.";

export type GatherLmeLimits = {
  maxPartChars?: number;
  maxTotalChars?: number;
};

function truncate(s: string, max: number): { text: string; truncated: boolean } {
  if (s.length <= max) return { text: s, truncated: false };
  return {
    text: `${s.slice(0, max)}\n\n…[truncated — source exceeded ${max.toLocaleString()} characters]`,
    truncated: true,
  };
}

function isKpiUserAddedDocId(docId: string): boolean {
  return docId.startsWith("wp-add-");
}

function kpiStrictPartCapForDoc(doc: LmeRawDocument | undefined, globalTask: LmeRetrievalPackTask | undefined): number | null {
  if (globalTask !== "kpi" || !doc) return null;
  const fn = basenameLower(doc.file ?? doc.label ?? "");
  if (isKpiUserAddedDocId(doc.docId) || kpiFilenameSuggestsCreditAgreementOrIndenture(fn)) {
    return kpiExtraIngestMaxPartChars();
  }
  return null;
}

function buildKpiMaxPerDocResolver(docs: LmeRawDocument[]): (docId: string) => number {
  const byId = new Map(docs.map((d) => [d.docId, d]));
  const defaultMax = lmeGlobalMaxChunksPerDocument();
  const extraMax = kpiExtraIngestMaxChunksPerDocument();
  const creditMax = kpiCreditDocExtraIngestMaxChunksPerDocument();
  return (docId: string) => {
    const doc = byId.get(docId);
    if (!doc) return defaultMax;
    const fn = basenameLower(doc.file ?? doc.label ?? "");
    if (kpiFilenameSuggestsCreditAgreementOrIndenture(fn)) return creditMax;
    if (isKpiUserAddedDocId(docId)) return extraMax;
    return defaultMax;
  };
}

function hashShort(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function lmeSourcesFingerprint(parts: LmeSourcePart[], retrievalUsed = false): string {
  const base = parts.map((p) => `${p.label}:${p.content.length}:${hashShort(p.content)}`).join("|");
  return `${base}|ret:${retrievalUsed ? "1" : "0"}`;
}

/** Fingerprint from raw corpus (tier order). Used for LME cache staleness so refresh vs run packing does not false-positive stale. */
export function lmeRawSourcesFingerprint(rawDocs: LmeRawDocument[]): string {
  const docs = [...rawDocs].sort((a, b) => a.tier - b.tier || a.seq - b.seq);
  return docs.map((d) => `${d.label}:${d.raw.length}:${hashShort(d.raw)}`).join("|");
}

export function formatSourcesForLme(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header = `Ticker: ${sym}\nThe blocks below combine (1) saved tabs from the Capital Structure section plus the saved Business Model tab, (2) uploaded credit / covenant documents from the Capital Structure section, (3) Excel extracts from Capital Structure / Org Chart / Subsidiary List trees. When embedding retrieval is active (default), each source contributes at least one ranked excerpt under the ${LME_DEFAULT_BUNDLE_CHAR_CAP.toLocaleString()}-character bundle ceiling; otherwise sources pack sequentially in priority order. Set \`LME_RETRIEVAL=0\` to force sequential pack. General Saved Documents outside the Capital Structure section are not included. Use them as the primary factual basis.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

let docCounter = 0;
function nextDocId(): string {
  docCounter += 1;
  return `lme-${docCounter.toString(36)}`;
}

/**
 * Load all LME-relevant sources as raw text with tier tags (no per-part truncation yet).
 */
export async function collectLmeRawDocuments(
  ticker: string,
  userId?: string | null,
  reporter?: SourceGatherProgressReporter
): Promise<LmeRawDocument[]> {
  docCounter = 0;
  const out: LmeRawDocument[] = [];
  let seq = 0;

  const push = (d: Omit<LmeRawDocument, "docId" | "seq"> & { docId?: string }) => {
    out.push({
      docId: d.docId ?? nextDocId(),
      seq: seq++,
      tier: d.tier,
      label: d.label,
      key: d.key,
      file: d.file,
      raw: d.raw,
    });
  };

  for (const { key, label } of LME_SAVED_TAB_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    push({ tier: 0, label, key, raw });
  }

  for (const { key, label } of CREDIT_AGREEMENTS_SAVED_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    push({ tier: 1, label, key, raw });
  }

  if (userId) {
    const sym = sanitizeTicker(ticker);
    if (sym) {
      const extractItems: Array<{ label: string; run: () => Promise<void> }> = [];

      const uploads = await listCreditAgreementsFiles(userId, ticker);
      if (uploads) {
        for (const u of uploads) {
          const displayName = (u.originalName || u.filename || "file").trim();
          extractItems.push({
            label: displayName,
            run: async () => {
              try {
                const buf = await workspaceReadFile(userId, sym, `Credit Agreements & Indentures/${u.filename}`);
                if (!buf?.length) return;
                const extracted = await extractBytesForAi(displayName, buf);
                const tier = tierForExtractedBody(displayName, extracted);
                push({
                  tier,
                  label: `Credit Agreements — Uploaded: ${u.originalName || u.filename}`,
                  file: u.filename,
                  raw: extracted,
                });
              } catch {
                /* skip */
              }
            },
          });
        }
      }

      const csItems = await listCapitalStructureExcels(userId, sym);
      if (csItems) {
        for (const it of csItems) {
          const displayName = it.originalName || it.filename || "file";
          extractItems.push({
            label: displayName,
            run: async () => {
              const buf = await getCapitalStructureExcelBuffer(userId, sym, it.filename);
              if (!buf?.length) return;
              const name = it.originalName?.toLowerCase().endsWith(".xlsx")
                ? it.originalName
                : `${it.originalName || "file"}.xlsx`;
              try {
                const extracted = await extractBytesForAi(name, buf);
                push({
                  tier: 3,
                  label: `Capital Structure — Excel: ${it.originalName}`,
                  file: it.filename,
                  raw: extracted,
                });
              } catch {
                /* skip */
              }
            },
          });
        }
      }

      const ocItems = await listOrgChartExcels(userId, sym);
      if (ocItems) {
        for (const it of ocItems) {
          const displayName = it.originalName || it.filename || "file";
          extractItems.push({
            label: displayName,
            run: async () => {
              const buf = await getOrgChartExcelBuffer(userId, sym, it.filename);
              if (!buf?.length) return;
              const name = it.originalName?.toLowerCase().endsWith(".xlsx")
                ? it.originalName
                : `${it.originalName || "file"}.xlsx`;
              try {
                const extracted = await extractBytesForAi(name, buf);
                push({
                  tier: 3,
                  label: `Org Chart — Excel: ${it.originalName}`,
                  file: it.filename,
                  raw: extracted,
                });
              } catch {
                /* skip */
              }
            },
          });
        }
      }

      const subItems = await listSubsidiaryListExcels(userId, sym);
      if (subItems) {
        for (const it of subItems) {
          const displayName = it.originalName || it.filename || "file";
          extractItems.push({
            label: displayName,
            run: async () => {
              const buf = await getSubsidiaryListExcelBuffer(userId, sym, it.filename);
              if (!buf?.length) return;
              const name = it.originalName?.toLowerCase().endsWith(".xlsx")
                ? it.originalName
                : `${it.originalName || "file"}.xlsx`;
              try {
                const extracted = await extractBytesForAi(name, buf);
                push({
                  tier: 3,
                  label: `Subsidiary List — Excel: ${it.originalName}`,
                  file: it.filename,
                  raw: extracted,
                });
              } catch {
                /* skip */
              }
            },
          });
        }
      }

      await runExtractLoop(reporter, "extracting", extractItems);
    }
  }

  return out.sort((a, b) => a.tier - b.tier || a.seq - b.seq);
}

export type LmeRetrievalPackDocRow = {
  docId: string;
  label: string;
  key?: string;
  file?: string;
  /** How many retrieved chunks from this document were packed into the final context window. */
  chunksFromDocInWindow: number;
};

export type LmeRetrievalPackDiagnostics = {
  mode: "global" | "legacy_queue";
  task: LmeRetrievalPackTask;
  /** Chunks built from the corpus (before `LME_GLOBAL_RANK_MAX_CHUNKS` cap, when global). */
  chunksBuilt: number;
  /** Chunks sent through the embedding API for this run (after cap). */
  chunksEmbedded: number;
  /** Max chunk count env for global mode (meaningful when `corpusChunksWereCapped`). */
  chunkCap?: number;
  corpusChunksWereCapped: boolean;
  /** Chunks selected into the final ranked blob under the bundle cap. */
  chunksInWindow: number;
  /** Lines of the fixed embedding query text (each line is a phrase list used for cosine similarity). */
  rankingQueryLines: string[];
  /** Source documents that contributed at least one chunk to the window, sorted by chunk count. */
  documentsInWindow: LmeRetrievalPackDocRow[];
};

function rankingQueryLinesForTask(task: LmeRetrievalPackTask): string[] {
  return retrievalQueryForTask(task)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function documentsContributingToWindow(
  picked: LmeIndexedChunk[],
  docs: LmeRawDocument[]
): LmeRetrievalPackDocRow[] {
  const counts = new Map<string, number>();
  for (const c of picked) {
    counts.set(c.docId, (counts.get(c.docId) ?? 0) + 1);
  }
  const meta = new Map(docs.map((d) => [d.docId, d]));
  const rows: LmeRetrievalPackDocRow[] = [];
  for (const [docId, chunksFromDocInWindow] of counts) {
    const d = meta.get(docId);
    const label = d?.label ?? picked.find((p) => p.docId === docId)?.label ?? docId;
    rows.push({
      docId,
      label,
      key: d?.key,
      file: d?.file,
      chunksFromDocInWindow,
    });
  }
  rows.sort(
    (a, b) =>
      b.chunksFromDocInWindow - a.chunksFromDocInWindow || a.label.localeCompare(b.label, undefined, { sensitivity: "base" })
  );
  return rows;
}

export type LmeDocumentPackedRow = {
  label: string;
  key?: string;
  file?: string;
  /** Full extracted text available for this source before packing. */
  charsAvailable: number;
  /** Characters from this source included in the context window (0 if omitted). */
  packedChars: number;
  /** Retrieved chunks from this source in the last ranked pack (when embedding retrieval ran). */
  chunksInWindow?: number;
};

function chunkCountsByDocLabel(
  docs: LmeRawDocument[],
  retrievalPack?: LmeRetrievalPackDiagnostics
): Map<string, number> {
  const out = new Map<string, number>();
  if (!retrievalPack?.documentsInWindow?.length) return out;
  const docById = new Map(docs.map((d) => [d.docId, d]));
  for (const row of retrievalPack.documentsInWindow) {
    const doc = docById.get(row.docId);
    const lookup = doc?.label ?? row.label;
    out.set(lookup, row.chunksFromDocInWindow);
  }
  return out;
}

function buildDocumentPackedRows(
  docs: LmeRawDocument[],
  packedByDocId: Map<string, number>,
  retrievalPack?: LmeRetrievalPackDiagnostics
): LmeDocumentPackedRow[] {
  const chunkByLabel = chunkCountsByDocLabel(docs, retrievalPack);
  return docs.map((d) => ({
    label: d.label,
    key: d.key,
    file: d.file,
    charsAvailable: d.raw.length,
    packedChars: packedByDocId.get(d.docId) ?? 0,
    chunksInWindow: chunkByLabel.get(d.label),
  }));
}

function addPickedChunkChars(packedByDocId: Map<string, number>, picked: LmeIndexedChunk[]): void {
  for (const c of picked) {
    packedByDocId.set(c.docId, (packedByDocId.get(c.docId) ?? 0) + c.text.length);
  }
}

export async function packLmeSourcesForModel(
  ticker: string,
  userId: string | null | undefined,
  rawDocs: LmeRawDocument[],
  limits: GatherLmeLimits | undefined,
  opts: {
    useRetrieval: boolean;
    apiKeys?: LlmCallApiKeys;
    inventoryOnly?: boolean;
    /** Chunk entire corpus, embed once, rank with task-specific query, fill bundle cap (LME vs KPI). */
    globalChunkPackTask?: LmeRetrievalPackTask;
  }
): Promise<{
  parts: LmeSourcePart[];
  retrievalUsed: boolean;
  retrievalPack?: LmeRetrievalPackDiagnostics;
  documentRows: LmeDocumentPackedRow[];
}> {
  const maxPartChars = limits?.maxPartChars ?? DEFAULT_MAX_PART_CHARS;
  const maxTotalChars = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const inlineMax = lmeFullInlineMaxChars();
  const docs = [...rawDocs].sort((a, b) => a.tier - b.tier || a.seq - b.seq);

  const parts: LmeSourcePart[] = [];
  let used = 0;
  const packedByDocId = new Map<string, number>(docs.map((d) => [d.docId, 0]));

  /** Full raw text per source for the LME tab inventory only (no per-part or bundle truncation; no retrieval). */
  if (opts.inventoryOnly === true) {
    for (const d of docs) {
      parts.push({
        label: d.label,
        key: d.key,
        file: d.file,
        content: d.raw,
        truncated: false,
        charsInitial: d.raw.length,
      });
    }
    return { parts, retrievalUsed: false, documentRows: buildDocumentPackedRows(docs, packedByDocId, undefined) };
  }

  let retrievalPack: LmeRetrievalPackDiagnostics | undefined;

  const globalTask = opts.globalChunkPackTask;
  const docById = new Map(docs.map((d) => [d.docId, d]));
  const kpiMaxPerDoc =
    globalTask === "kpi" ? buildKpiMaxPerDocResolver(docs) : () => lmeGlobalMaxChunksPerDocument();

  function partCharCapForDoc(docId: string | undefined): number {
    if (!docId) return maxPartChars;
    const strict = kpiStrictPartCapForDoc(docById.get(docId), globalTask);
    return strict ?? maxPartChars;
  }

  function appendPart(
    label: string,
    raw: string,
    extra?: { key?: string; file?: string; docId?: string }
  ): void {
    const charsInitial = raw.length;
    const { text, truncated } = truncate(raw, partCharCapForDoc(extra?.docId));
    const room = maxTotalChars - used;
    if (room <= 0) return;
    let content = text;
    let tr = truncated;
    if (content.length > room) {
      content = `${content.slice(0, room)}\n\n…[truncated for LME bundle size limit]`;
      tr = true;
    }
    parts.push({ label, ...extra, content, truncated: tr, charsInitial });
    if (extra?.docId) {
      packedByDocId.set(extra.docId, (packedByDocId.get(extra.docId) ?? 0) + content.length);
    }
    used += content.length;
  }

  const retrievalQueue: { docId: string; label: string; raw: string }[] = [];
  let retrievalUsed = false;

  const retrievalOn =
    opts.useRetrieval === true &&
    Boolean(userId) &&
    isLmeRetrievalEnabled() &&
    hasAnyKpiEmbeddingKey(opts.apiKeys);

  if (
    retrievalOn &&
    userId &&
    opts.apiKeys &&
    (globalTask === "lme" || globalTask === "kpi" || globalTask === "forensic" || globalTask === "creative")
  ) {
    const allChunks = docs.flatMap((d) =>
      buildLmeChunksForDocument(
        d.docId,
        d.label,
        d.raw.slice(0, Math.min(d.raw.length, MAX_RAW_CHARS_FOR_RETRIEVAL))
      )
    );
    const maxChunks = lmeGlobalRankMaxChunks();
    const { capped, corpusChunksWereCapped } = capLmeChunksPreservingEachDocument(allChunks, maxChunks);
    if (corpusChunksWereCapped) {
      console.warn(
        `[lme-sources] global ranked pack: capping chunks ${allChunks.length} → ${capped.length} (LME_GLOBAL_RANK_MAX_CHUNKS); at least one chunk per source preserved for embedding`
      );
    }
    if (capped.length > 0) {
      const sym = sanitizeTicker(ticker) || "";
      const vectors = await ensureLmeRetrievalEmbeddings(userId, sym, capped, opts.apiKeys);
      const qVec = await embedRetrievalQueryForTask(globalTask, opts.apiKeys);
      if (vectors && qVec) {
        const picked = selectLmeChunksForBudget(
          qVec,
          capped,
          vectors,
          maxTotalChars,
          lmeGlobalMaxChunksPerDocument(),
          globalTask,
          kpiMaxPerDoc
        );
        if (picked.length > 0) {
          const blob = formatRetrievedChunksForPrompt(picked, globalTask);
          const label =
            globalTask === "kpi"
              ? "KPI commentary — ranked context pack (embedding retrieval)"
              : globalTask === "forensic"
                ? "Forensic accounting — ranked context pack (embedding retrieval)"
                : globalTask === "creative"
                  ? "Work Product — ranked context pack (embedding retrieval)"
                  : "LME analysis — ranked context pack (embedding retrieval)";
          parts.push({
            label,
            content: blob,
            truncated: false,
            charsInitial: docs.reduce((s, d) => s + d.raw.length, 0),
          });
          retrievalPack = {
            mode: "global",
            task: globalTask,
            chunksBuilt: allChunks.length,
            chunksEmbedded: capped.length,
            chunkCap: maxChunks,
            corpusChunksWereCapped: corpusChunksWereCapped,
            chunksInWindow: picked.length,
            rankingQueryLines: rankingQueryLinesForTask(globalTask),
            documentsInWindow: documentsContributingToWindow(picked, docs),
          };
          addPickedChunkChars(packedByDocId, picked);
          return {
            parts,
            retrievalUsed: true,
            retrievalPack,
            documentRows: buildDocumentPackedRows(docs, packedByDocId, retrievalPack),
          };
        }
      }
    }

    if (retrievalOn) {
      throw new LmeRetrievalRequiredError(LME_RETRIEVAL_REQUIRED_HINT);
    }
  }

  if (globalTask && opts.useRetrieval === true && !retrievalOn) {
    throw new LmeRetrievalRequiredError(LME_RETRIEVAL_REQUIRED_HINT);
  }

  for (const d of docs) {
    const rawCappedLen = Math.min(d.raw.length, MAX_RAW_CHARS_FOR_RETRIEVAL);
    const wantsRetrieval = retrievalOn && d.tier >= 2 && rawCappedLen > inlineMax;

    if (wantsRetrieval) {
      retrievalQueue.push({
        docId: d.docId,
        label: d.label,
        raw: d.raw.slice(0, Math.min(d.raw.length, MAX_RAW_CHARS_FOR_RETRIEVAL)),
      });
      continue;
    }

    appendPart(d.label, d.raw, { key: d.key, file: d.file, docId: d.docId });
  }

  if (retrievalQueue.length && retrievalOn && userId && opts.apiKeys) {
    const allChunks = retrievalQueue.flatMap((rb) => buildLmeChunksForDocument(rb.docId, rb.label, rb.raw));
    const budget = Math.max(0, maxTotalChars - used - 500);
    if (allChunks.length > 0 && budget > 3_000) {
      const vectors = await ensureLmeRetrievalEmbeddings(userId, sanitizeTicker(ticker) || "", allChunks, opts.apiKeys);
      const qVec = await embedLmeRetrievalQuery(opts.apiKeys);
      if (vectors && qVec) {
        const picked = selectLmeChunksForBudget(
          qVec,
          allChunks,
          vectors,
          budget,
          lmeMaxChunksPerDocument(),
          "lme"
        );
        if (picked.length > 0) {
          const blob = formatRetrievedChunksForPrompt(picked, "lme");
          addPickedChunkChars(packedByDocId, picked);
          appendPart("LME retrieval — ranked excerpts (long SEC / filings / spreadsheets)", blob);
          retrievalUsed = true;
          retrievalPack = {
            mode: "legacy_queue",
            task: "lme",
            chunksBuilt: allChunks.length,
            chunksEmbedded: allChunks.length,
            corpusChunksWereCapped: false,
            chunksInWindow: picked.length,
            rankingQueryLines: rankingQueryLinesForTask("lme"),
            documentsInWindow: documentsContributingToWindow(picked, docs),
          };
        }
      }
    }
  }

  if (!retrievalUsed && retrievalQueue.length) {
    for (const rb of retrievalQueue) {
      appendPart(`${rb.label} (retrieval off or failed — per-source cap only)`, rb.raw, { docId: rb.docId });
    }
  }

  return {
    parts,
    retrievalUsed,
    retrievalPack,
    documentRows: buildDocumentPackedRows(docs, packedByDocId, retrievalPack),
  };
}

export type LmePackedBlockRow = {
  label: string;
  key?: string;
  file?: string;
  /** Raw length for this block before per-part truncation (same as inventory `charsInitial`). */
  charsInitial: number;
  /** Length of `content` actually packed into the prompt for this block. */
  packedChars: number;
  truncated: boolean;
};

export type LmeRunPackingStats = {
  /** Sum of raw `LmeRawDocument.raw` lengths (pre-pack corpus). */
  rawSourceCharsSum: number;
  /** Sum of packed `LmeSourcePart.content` lengths (what counts toward the bundle cap). */
  packedPartsCharSum: number;
  bundleCharCap: number;
  perPartCharCap: number;
  retrievalUsed: boolean;
  blocksInPack: number;
  /** One row per packed block, in tier/source order, for last-run diagnostics. */
  blockRows: LmePackedBlockRow[];
  /** One row per source document with chars included in the last context window. */
  documentRows: LmeDocumentPackedRow[];
  /** Present when embedding retrieval produced a ranked chunk window for this run. */
  retrievalPack?: LmeRetrievalPackDiagnostics;
};

export async function gatherLmeSources(
  ticker: string,
  limits?: GatherLmeLimits,
  userId?: string | null,
  opts?: {
    apiKeys?: LlmCallApiKeys;
    useRetrieval?: boolean;
    inventoryOnly?: boolean;
    /** When retrieval runs, which task query drives global chunk ranking (default `lme`). */
    globalChunkPackTask?: LmeRetrievalPackTask;
    progressKey?: string;
  }
): Promise<{
  parts: LmeSourcePart[];
  totalChars: number;
  nonEmptyCount: number;
  hasSubstantiveText: boolean;
  retrievalUsed: boolean;
  /** Raw-corpus fingerprint for cache staleness (independent of run-time truncation / retrieval packing). */
  sourceFingerprint: string;
  /** Populated on run pack only (omitted for `inventoryOnly` refresh). */
  packingStats?: LmeRunPackingStats;
  /** Same corpus as fingerprinting / packing (for prompts that need a per-document inventory). */
  rawDocuments: LmeRawDocument[];
}> {
  const rawDocs = await collectWorkProductRawDocumentsWithAdditions(
    "lme",
    ticker,
    userId,
    (reporter) => collectLmeRawDocuments(ticker, userId, reporter),
    opts?.progressKey
  );
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack, documentRows } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
    useRetrieval: opts?.useRetrieval === true,
    apiKeys: opts?.apiKeys,
    inventoryOnly: opts?.inventoryOnly === true,
    globalChunkPackTask:
      opts?.useRetrieval === true && opts?.inventoryOnly !== true
        ? (opts.globalChunkPackTask ?? "lme")
        : undefined,
  });

  const bundleCharCap = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const perPartCharCap = limits?.maxPartChars ?? DEFAULT_MAX_PART_CHARS;
  const packingStats: LmeRunPackingStats | undefined =
    opts?.inventoryOnly === true
      ? undefined
      : {
          rawSourceCharsSum: rawDocs.reduce((s, d) => s + d.raw.length, 0),
          packedPartsCharSum: parts.reduce((s, p) => s + p.content.length, 0),
          bundleCharCap,
          perPartCharCap,
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
