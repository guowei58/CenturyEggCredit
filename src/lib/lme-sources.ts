/**
 * Aggregate Capital Structure section sources for LME analysis (saved text + Excel + credit docs),
 * with priority tiers (saved responses → covenant saves → SEC/transcripts/decks → bulk) and optional
 * embedding retrieval for long documents (same embedding stack as KPI).
 * Saved Documents from Postgres are filtered to the same work-product rules as Capital Structure ingest
 * (`capstructure` scope) plus an LME topic gate — not every saved HTML/PDF is included.
 */

import path from "path";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { CREDIT_AGREEMENTS_SAVED_KEYS } from "@/lib/covenant-sources";
import { listCreditAgreementsFiles } from "@/lib/credit-agreements-files";
import { workspaceReadFile } from "@/lib/user-ticker-workspace-store";
import { listAllUserSavedDocumentsBodiesForIngest } from "@/lib/user-workspace-store";
import { userSavedDocumentIncludedInLmeCorpus } from "@/lib/lme-saved-documents-filter";
import { listCapitalStructureExcels, getCapitalStructureExcelBuffer } from "@/lib/capital-structure-excel";
import { listOrgChartExcels, getOrgChartExcelBuffer } from "@/lib/org-chart-excel";
import { listSubsidiaryListExcels, getSubsidiaryListExcelBuffer } from "@/lib/subsidiary-list-excel";
import { extractBytesForAi } from "@/lib/ticker-file-text-extract";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import type { LmeTier } from "@/lib/lme-tier-classify";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { hasAnyKpiEmbeddingKey } from "@/lib/kpi-embedding-provider";
import {
  buildLmeChunksForDocument,
  embedLmeRetrievalQuery,
  embedRetrievalQueryForTask,
  ensureLmeRetrievalEmbeddings,
  formatRetrievedChunksForPrompt,
  isLmeRetrievalEnabled,
  lmeFullInlineMaxChars,
  lmeGlobalMaxChunksPerDocument,
  lmeGlobalRankMaxChunks,
  lmeMaxChunksPerDocument,
  retrievalQueryForTask,
  selectLmeChunksForBudget,
  type LmeIndexedChunk,
  type LmeRetrievalPackTask,
} from "@/lib/lme-retrieval";

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

const CAPITAL_STRUCTURE_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "capital-structure", label: "Capital Structure — Saved response" },
];

const ORG_CHART_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "org-chart-prompt", label: "Org Chart — Saved response" },
];

const SUBSIDIARY_LIST_TEXT_KEYS: ReadonlyArray<{ key: string; label: string }> = [
  { key: "subsidiary-list", label: "Subsidiary List — Saved response" },
];

/** Max characters per source block after extraction, before bundle trim (material contracts can exceed this alone). */
export const LME_DEFAULT_PER_PART_CHAR_CAP = 140_000;
const DEFAULT_MAX_PART_CHARS = LME_DEFAULT_PER_PART_CHAR_CAP;
/**
 * Max sum of packed `part.content` lengths sent into `formatSourcesForLme` (server-side LME context budget).
 * Framing lines (`==========`, SOURCE: …) add a little on top; the fixed LME task spec is separate in the user message.
 */
export const LME_DEFAULT_BUNDLE_CHAR_CAP = 520_000;
const DEFAULT_MAX_TOTAL_CHARS = LME_DEFAULT_BUNDLE_CHAR_CAP;
const MAX_RAW_CHARS_FOR_RETRIEVAL = 600_000;

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
  const header = `Ticker: ${sym}\nThe blocks below combine (1) saved tab responses in priority order, (2) covenant / credit-agreement saves and uploads, (3) Saved Documents that pass LME filters (cap-structure work-product ingest rules plus debt/SEC-style filename checks—not every saved file), (4) Excel extracts from Capital Structure / Org Chart / Subsidiary List trees, and (5) when retrieval is enabled, typically one embedding-ranked context pack assembled from the full ingested corpus under the character ceiling (otherwise per-source blocks with optional ranked excerpts for long documents only). Use them as the primary factual basis.\n\n`;
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
export async function collectLmeRawDocuments(ticker: string, userId?: string | null): Promise<LmeRawDocument[]> {
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

  for (const { key, label } of CAPITAL_STRUCTURE_TEXT_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    push({ tier: 0, label, key, raw });
  }

  for (const { key, label } of ORG_CHART_TEXT_KEYS) {
    const raw = (await readSavedContent(ticker, key, userId))?.trim() ?? "";
    if (!raw) continue;
    push({ tier: 0, label, key, raw });
  }

  for (const { key, label } of SUBSIDIARY_LIST_TEXT_KEYS) {
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
      const uploads = await listCreditAgreementsFiles(userId, ticker);
      if (uploads) {
        for (const u of uploads) {
          try {
            const buf = await workspaceReadFile(userId, sym, `Credit Agreements & Indentures/${u.filename}`);
            if (!buf?.length) continue;
            const name = (u.originalName || u.filename || "file").trim();
            const extracted = await extractBytesForAi(name, buf);
            const tier = tierForExtractedBody(name, extracted);
            push({
              tier,
              label: `Credit Agreements — Uploaded: ${u.originalName || u.filename}`,
              file: u.filename,
              raw: extracted,
            });
          } catch {
            /* skip */
          }
        }
      }

      const savedDocs = await listAllUserSavedDocumentsBodiesForIngest(userId, sym);
      for (const { filename, body } of savedDocs) {
        const fn = filename.trim();
        if (!fn) continue;
        const gate = userSavedDocumentIncludedInLmeCorpus(fn, body.length);
        if (!gate.ok) continue;
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

      const csItems = await listCapitalStructureExcels(userId, sym);
      if (csItems) {
        for (const it of csItems) {
          const buf = await getCapitalStructureExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
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
        }
      }

      const ocItems = await listOrgChartExcels(userId, sym);
      if (ocItems) {
        for (const it of ocItems) {
          const buf = await getOrgChartExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
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
        }
      }

      const subItems = await listSubsidiaryListExcels(userId, sym);
      if (subItems) {
        for (const it of subItems) {
          const buf = await getSubsidiaryListExcelBuffer(userId, sym, it.filename);
          if (!buf?.length) continue;
          const name = it.originalName?.toLowerCase().endsWith(".xlsx") ? it.originalName : `${it.originalName || "file"}.xlsx`;
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
        }
      }
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
): Promise<{ parts: LmeSourcePart[]; retrievalUsed: boolean; retrievalPack?: LmeRetrievalPackDiagnostics }> {
  const maxPartChars = limits?.maxPartChars ?? DEFAULT_MAX_PART_CHARS;
  const maxTotalChars = limits?.maxTotalChars ?? DEFAULT_MAX_TOTAL_CHARS;
  const inlineMax = lmeFullInlineMaxChars();
  const docs = [...rawDocs].sort((a, b) => a.tier - b.tier || a.seq - b.seq);

  const parts: LmeSourcePart[] = [];
  let used = 0;

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
    return { parts, retrievalUsed: false };
  }

  let retrievalPack: LmeRetrievalPackDiagnostics | undefined;

  function appendPart(label: string, raw: string, extra?: { key?: string; file?: string }): void {
    const charsInitial = raw.length;
    const { text, truncated } = truncate(raw, maxPartChars);
    const room = maxTotalChars - used;
    if (room <= 0) return;
    let content = text;
    let tr = truncated;
    if (content.length > room) {
      content = `${content.slice(0, room)}\n\n…[truncated for LME bundle size limit]`;
      tr = true;
    }
    parts.push({ label, ...extra, content, truncated: tr, charsInitial });
    used += content.length;
  }

  const retrievalQueue: { docId: string; label: string; raw: string }[] = [];
  let retrievalUsed = false;

  const retrievalOn =
    opts.useRetrieval === true &&
    Boolean(userId) &&
    isLmeRetrievalEnabled() &&
    hasAnyKpiEmbeddingKey(opts.apiKeys);

  const globalTask = opts.globalChunkPackTask;
  if (
    retrievalOn &&
    userId &&
    opts.apiKeys &&
    (globalTask === "lme" || globalTask === "kpi" || globalTask === "forensic")
  ) {
    const allChunks = docs.flatMap((d) =>
      buildLmeChunksForDocument(
        d.docId,
        d.label,
        d.raw.slice(0, Math.min(d.raw.length, MAX_RAW_CHARS_FOR_RETRIEVAL))
      )
    );
    const maxChunks = lmeGlobalRankMaxChunks();
    let capped = allChunks;
    if (allChunks.length > maxChunks) {
      console.warn(
        `[lme-sources] global ranked pack: capping chunks ${allChunks.length} → ${maxChunks} (LME_GLOBAL_RANK_MAX_CHUNKS); earlier corpus sources keep priority`
      );
      capped = allChunks.slice(0, maxChunks);
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
          globalTask
        );
        if (picked.length > 0) {
          const blob = formatRetrievedChunksForPrompt(picked, globalTask);
          const label =
            globalTask === "kpi"
              ? "KPI commentary — ranked context pack (embedding retrieval)"
              : globalTask === "forensic"
                ? "Forensic accounting — ranked context pack (embedding retrieval)"
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
            corpusChunksWereCapped: allChunks.length > maxChunks,
            chunksInWindow: picked.length,
            rankingQueryLines: rankingQueryLinesForTask(globalTask),
            documentsInWindow: documentsContributingToWindow(picked, docs),
          };
          return { parts, retrievalUsed: true, retrievalPack };
        }
      }
    }
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

    appendPart(d.label, d.raw, { key: d.key, file: d.file });
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
      appendPart(`${rb.label} (retrieval off or failed — per-source cap only)`, rb.raw, {});
    }
  }

  return { parts, retrievalUsed, retrievalPack };
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
  const rawDocs = await collectLmeRawDocuments(ticker, userId);
  const sourceFingerprint = lmeRawSourcesFingerprint(rawDocs);
  const { parts, retrievalUsed, retrievalPack } = await packLmeSourcesForModel(ticker, userId, rawDocs, limits, {
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
