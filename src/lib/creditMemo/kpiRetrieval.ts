/**
 * KPI evidence selection: embed chunks (OpenAI preferred, else Gemini, else DeepSeek when available),
 * store in workspace, retrieve top chunks for the KPI question string instead of sending the full
 * corpus when an embedding-capable key is available. Anthropic does not expose a compatible
 * embeddings API here — use OpenAI or Gemini for retrieval.
 *
 * **AI Memo & Deck** reuses the same chunk cache and ranking helpers via {@link resolveCreditMemoEvidencePack}
 * (query = memo/deck title + section headings).
 */

import { prisma } from "@/lib/prisma";
import { withTransientPgRetry } from "@/lib/pg-connection-retry";
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import {
  workspaceDeleteFile,
  workspaceReadUtf8,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "@/lib/openai-embeddings";
import {
  embedKpiBatchForRetrieval,
  embedTextsForKpiRetrieval,
  hasAnyKpiEmbeddingKey,
  resolveKpiEmbeddingBackendMetadata,
  type KpiEmbeddingProviderId,
} from "@/lib/kpi-embedding-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import type { CreditMemoProject, SourceChunkRecord } from "./types";
import { buildEvidencePackSync, computeMemoEvidenceSourceRows } from "./evidencePack";
import { MEMO_DECK_CONTEXT_MAX_CHARS } from "./config";
import { sortSourcesForEvidence } from "./memoPlanner";
import { CREDIT_MEMO_CHUNK_MAX_CHARS, CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";
import { joinSourceChunksWithoutOverlap } from "./chunkStitch";

const STORAGE_PREFIX = "credit-memo/kpi-embeddings";

/** Matches prior KPI evidence query — used as the retrieval query embedding. */
export const KPI_RETRIEVAL_QUERY = [
  "KPI key performance indicator operating metric revenue driver cost driver",
  "net adds churn ARPU subscribers volume units utilization load factor occupancy RASM CASM yield",
  "pricing mix margin unit economics contribution margin take rate bookings backlog",
  "capex intensity opex run-rate cost savings productivity",
  "management commentary said we expect guidance",
].join("\n");

type StoredEmbeddings = {
  /** Defaults to openai for files written before multi-provider support. */
  embeddingProvider?: KpiEmbeddingProviderId;
  embeddingModel: string;
  dimensions: number;
  projectUpdatedAt: string;
  vectors: Record<string, number[]>;
  /** Chunk ids embedded in this cache row (supports partial/resume). */
  embeddedChunkIds?: string[];
};

/** Cap total chunks embedded for memo/KPI retrieval (corpus order; at least one chunk per source preserved). */
export function memoEmbedMaxChunks(): number {
  return parseEnvInt("MEMO_EMBED_MAX_CHUNKS", 5_000, 200, 25_000);
}

function memoEmbedBatchSize(): number {
  return parseEnvInt("MEMO_EMBED_BATCH_SIZE", 64, 8, 128);
}

/** Persist partial cache every N embedding batches during long runs. */
function memoEmbedSaveEveryBatches(): number {
  return parseEnvInt("MEMO_EMBED_SAVE_EVERY_BATCHES", 4, 1, 32);
}

/**
 * When the corpus exceeds `maxChunks`, keep at least one chunk per source file in the embed
 * batch so no ingested file is excluded from embedding entirely.
 */
export function capMemoChunksPreservingEachSource(
  chunks: SourceChunkRecord[],
  maxChunks: number
): { capped: SourceChunkRecord[]; corpusChunksWereCapped: boolean } {
  if (chunks.length <= maxChunks) {
    return { capped: chunks, corpusChunksWereCapped: false };
  }

  const bySource = new Map<string, SourceChunkRecord[]>();
  for (const c of chunks) {
    if (!bySource.has(c.sourceFileId)) bySource.set(c.sourceFileId, []);
    bySource.get(c.sourceFileId)!.push(c);
  }

  const reserved: SourceChunkRecord[] = [];
  const reservedIds = new Set<string>();
  for (const sourceChunks of bySource.values()) {
    sourceChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const first = sourceChunks[0]!;
    if (!reservedIds.has(first.id)) {
      reserved.push(first);
      reservedIds.add(first.id);
    }
  }

  if (reserved.length >= maxChunks) {
    return { capped: reserved.slice(0, maxChunks), corpusChunksWereCapped: true };
  }

  const tail: SourceChunkRecord[] = [];
  for (const c of chunks) {
    if (!reservedIds.has(c.id)) tail.push(c);
  }

  return {
    capped: [...reserved, ...tail.slice(0, maxChunks - reserved.length)],
    corpusChunksWereCapped: true,
  };
}

function storagePath(projectId: string): string {
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${STORAGE_PREFIX}/${safe}.json`;
}

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Max characters of chunk text (+ wrappers) sent as KPI evidence when retrieval is active. */
export function kpiRetrievalMaxEvidenceChars(): number {
  return parseEnvInt("KPI_RETRIEVAL_MAX_EVIDENCE_CHARS", 240_000, 20_000, 2_000_000);
}

/** When retrieval is off or unavailable, cap full sequential pack size. */
export function kpiFallbackMaxEvidenceChars(): number {
  return parseEnvInt("KPI_FALLBACK_MAX_EVIDENCE_CHARS", 400_000, 40_000, 2_000_000);
}

export function isKpiRetrievalEnabled(): boolean {
  const v = process.env.KPI_RETRIEVAL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/**
 * AI Memo & Deck: embedding-ranked chunks by default (memo title + outline as query).
 * Set `MEMO_RETRIEVAL=0` to pack all ingested sources sequentially instead.
 */
export function isMemoRetrievalEnabled(): boolean {
  const v = process.env.MEMO_RETRIEVAL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/** Ranked chunk body budget when `MEMO_RETRIEVAL=1` and embeddings succeed. */
export function memoRetrievalMaxEvidenceChars(): number {
  return parseEnvInt("MEMO_RETRIEVAL_MAX_EVIDENCE_CHARS", MEMO_DECK_CONTEXT_MAX_CHARS, 20_000, 2_000_000);
}

/** Sequential evidence cap for memo/deck (all allowed sources, priority order). */
export function memoFallbackMaxEvidenceChars(): number {
  return parseEnvInt("MEMO_FALLBACK_MAX_EVIDENCE_CHARS", MEMO_DECK_CONTEXT_MAX_CHARS, 40_000, 2_000_000);
}

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

async function loadStored(userId: string, projectId: string): Promise<StoredEmbeddings | null> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, storagePath(projectId));
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as StoredEmbeddings;
  } catch {
    return null;
  }
}

async function saveStored(userId: string, projectId: string, data: StoredEmbeddings): Promise<void> {
  const json = JSON.stringify(data, null, 0);
  await withTransientPgRetry(
    "kpiEmbeddingsSave",
    async () => {
      /** Long embed runs idle the pool; warm before the large upsert. */
      try {
        await prisma.$connect();
      } catch {
        /* retry wrapper surfaces real errors */
      }
      const w = await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, storagePath(projectId), json);
      if (!w.ok) throw new Error(w.error);
    },
    { retries: 10, baseDelayMs: 500 }
  );
}

/** Best-effort cache write — never throws; retrieval can proceed with in-memory vectors. */
async function trySaveStored(userId: string, projectId: string, data: StoredEmbeddings): Promise<boolean> {
  try {
    await saveStored(userId, projectId, data);
    return true;
  } catch (e) {
    console.warn(
      "[kpiRetrieval] embedding cache write failed:",
      e instanceof Error ? e.message : e
    );
    return false;
  }
}

async function pingPgDuringLongJob(): Promise<void> {
  try {
    await withTransientPgRetry("kpiEmbeddingsPing", () => prisma.$queryRaw`SELECT 1`, {
      retries: 2,
      baseDelayMs: 200,
    });
  } catch {
    /* non-fatal — save path has its own retries */
  }
}

function storedMatchesBackend(
  existing: StoredEmbeddings,
  backend: { provider: KpiEmbeddingProviderId; model: string; dimensions: number },
  projectUpdatedAt: string
): boolean {
  return (
    existing.projectUpdatedAt === projectUpdatedAt &&
    existing.dimensions === backend.dimensions &&
    (existing.embeddingProvider ?? "openai") === backend.provider &&
    existing.embeddingModel === backend.model
  );
}

export type EnsureKpiChunkEmbeddingsResult = {
  vectors: Record<string, number[]> | null;
  error?: string;
  cacheSaved?: boolean;
  chunksEmbedded?: number;
  chunksEmbedCap?: number;
  corpusChunksWereCapped?: boolean;
};

export async function deleteKpiEmbeddingsFile(userId: string, projectId: string): Promise<void> {
  await workspaceDeleteFile(userId, WORKSPACE_GLOBAL_TICKER, storagePath(projectId));
}

/**
 * Ensure we have one embedding vector per chunk (keyed by chunk id). Recomputes when project
 * `updatedAt` changes or counts mismatch. Embeds incrementally with partial cache saves so a
 * stale Postgres connection after a long run does not discard all vectors.
 */
export async function ensureKpiChunkEmbeddings(
  userId: string,
  project: CreditMemoProject,
  apiKeys: LlmCallApiKeys | undefined
): Promise<EnsureKpiChunkEmbeddingsResult> {
  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);
  if (!backend) return { vectors: null, error: "No embedding API key configured." };

  const allChunks = project.chunks.filter((c) => c.text.trim().length > 0);
  if (allChunks.length === 0) return { vectors: null, error: "No non-empty ingest chunks." };

  const maxChunks = memoEmbedMaxChunks();
  const { capped, corpusChunksWereCapped } = capMemoChunksPreservingEachSource(allChunks, maxChunks);
  if (corpusChunksWereCapped) {
    console.warn(
      `[kpiRetrieval] capping embed corpus ${allChunks.length} → ${capped.length} (MEMO_EMBED_MAX_CHUNKS); at least one chunk per source preserved`
    );
  }

  const existing = await loadStored(userId, project.id);
  const vectors: Record<string, number[]> =
    existing && storedMatchesBackend(existing, backend, project.updatedAt)
      ? { ...existing.vectors }
      : {};

  if (capped.every((c) => vectors[c.id]?.length)) {
    return {
      vectors,
      cacheSaved: true,
      chunksEmbedded: capped.length,
      chunksEmbedCap: maxChunks,
      corpusChunksWereCapped,
    };
  }

  const batchSize = memoEmbedBatchSize();
  const saveEvery = memoEmbedSaveEveryBatches();
  let batchesSinceSave = 0;
  let cacheSaved = Boolean(existing && storedMatchesBackend(existing, backend, project.updatedAt));
  let lastError: string | undefined;

  const cachePayload = (): StoredEmbeddings => ({
    embeddingProvider: backend.provider,
    embeddingModel: backend.model,
    dimensions: backend.dimensions,
    projectUpdatedAt: project.updatedAt,
    vectors,
    embeddedChunkIds: Object.keys(vectors),
  });

  for (let i = 0; i < capped.length; i += batchSize) {
    const batchChunks = capped.slice(i, i + batchSize).filter((c) => !vectors[c.id]?.length);
    if (batchChunks.length === 0) continue;

    const texts = batchChunks.map((c) => c.text.slice(0, 30_000));
    const res = await embedKpiBatchForRetrieval(texts, apiKeys, backend, { timeoutMs: 120_000 });
    if (!res.ok) {
      lastError = res.error;
      console.error("[kpiRetrieval] embedding batch failed:", res.error);
      await trySaveStored(userId, project.id, cachePayload());
      const embedded = Object.keys(vectors).length;
      return {
        vectors: embedded > 0 ? vectors : null,
        error: res.error,
        cacheSaved: false,
        chunksEmbedded: embedded,
        chunksEmbedCap: maxChunks,
        corpusChunksWereCapped,
      };
    }

    batchChunks.forEach((c, j) => {
      vectors[c.id] = res.vectors[j]!;
    });
    batchesSinceSave++;

    const isLastBatch = i + batchSize >= capped.length;
    if (batchesSinceSave >= saveEvery || isLastBatch) {
      cacheSaved = (await trySaveStored(userId, project.id, cachePayload())) || cacheSaved;
      batchesSinceSave = 0;
      await pingPgDuringLongJob();
    }
  }

  if (!capped.every((c) => vectors[c.id]?.length)) {
    return {
      vectors: null,
      error: lastError ?? "Incomplete embedding batch",
      cacheSaved,
      chunksEmbedded: Object.keys(vectors).length,
      chunksEmbedCap: maxChunks,
      corpusChunksWereCapped,
    };
  }

  if (!cacheSaved) {
    cacheSaved = await trySaveStored(userId, project.id, cachePayload());
  }

  return {
    vectors,
    cacheSaved,
    chunksEmbedded: capped.length,
    chunksEmbedCap: maxChunks,
    corpusChunksWereCapped,
  };
}

export async function embedKpiQuery(apiKeys: LlmCallApiKeys | undefined): Promise<number[] | null> {
  const res = await embedTextsForKpiRetrieval([KPI_RETRIEVAL_QUERY], apiKeys, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    batchSize: 1,
  });
  if (!res.ok || !res.vectors[0]) return null;
  return res.vectors[0];
}

/** One embedding for the memo/deck outline string used to rank ingested project chunks. */
export async function embedCreditMemoRetrievalQuery(
  query: string,
  apiKeys: LlmCallApiKeys | undefined
): Promise<number[] | null> {
  const text = query.trim().slice(0, 30_000);
  if (!text) return null;
  const res = await embedTextsForKpiRetrieval([text], apiKeys, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    batchSize: 1,
  });
  if (!res.ok || !res.vectors[0]) return null;
  return res.vectors[0];
}

/**
 * Pick chunks by cosine similarity to queryVec.
 * Phase 1 reserves each source file's best-scoring chunk so no ingested file is omitted entirely.
 * Phase 2 fills remaining budget by score.
 */
export function selectChunksForKpiEvidence(
  project: CreditMemoProject,
  vectors: Record<string, number[]>,
  queryVec: number[],
  maxEvidenceChars: number
): SourceChunkRecord[] {
  const q = l2normalize(queryVec);
  const scored: { chunk: SourceChunkRecord; score: number }[] = [];
  const bestBySource = new Map<string, { chunk: SourceChunkRecord; score: number }>();
  for (const c of project.chunks) {
    const v = vectors[c.id];
    if (!v?.length) continue;
    const score = dot(q, l2normalize(v));
    scored.push({ chunk: c, score });
    const prev = bestBySource.get(c.sourceFileId);
    if (!prev || score > prev.score) bestBySource.set(c.sourceFileId, { chunk: c, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const picked: SourceChunkRecord[] = [];
  const pickedIds = new Set<string>();
  let used = 0;
  const overheadPerBlock = 120;

  const tryPick = (chunk: SourceChunkRecord): boolean => {
    if (pickedIds.has(chunk.id)) return false;
    const add = chunk.text.length + overheadPerBlock;
    if (used + add > maxEvidenceChars && picked.length > 0) return false;
    picked.push(chunk);
    pickedIds.add(chunk.id);
    used += add;
    return true;
  };

  const guaranteed = [...bestBySource.values()].sort((a, b) => b.score - a.score);
  for (const { chunk } of guaranteed) {
    tryPick(chunk);
  }

  for (const { chunk } of scored) {
    if (pickedIds.has(chunk.id)) continue;
    const add = chunk.text.length + overheadPerBlock;
    if (used + add > maxEvidenceChars && picked.length > 0) break;
    tryPick(chunk);
  }

  return picked;
}

/**
 * Build evidence string from selected chunks (grouped by source file, chunk index order).
 * @param subtitle Short description after `SOURCE PACK (` — e.g. ranked-chunk mode label.
 */
export function buildRankedChunkEvidencePack(
  project: CreditMemoProject,
  selected: SourceChunkRecord[],
  subtitle: string
): string {
  const bySource = new Map<string, SourceChunkRecord[]>();
  for (const c of selected) {
    if (!bySource.has(c.sourceFileId)) bySource.set(c.sourceFileId, []);
    bySource.get(c.sourceFileId)!.push(c);
  }
  for (const arr of bySource.values()) {
    arr.sort((a, b) => a.chunkIndex - b.chunkIndex);
  }

  const orderedSources = sortSourcesForEvidence(project.sources).filter((s) => bySource.has(s.id));

  const parts: string[] = [];
  const header = `# SOURCE PACK (${subtitle})\nTicker: ${project.ticker}\n\n`;
  parts.push(header);

  for (const src of orderedSources) {
    const list = bySource.get(src.id);
    if (!list?.length) continue;
    if (src.parseStatus === "skipped") continue;

    const blockHead = `\n<<<BEGIN SOURCE: ${src.relPath} | category=${src.category} | status=${src.parseStatus}>>>\n`;
    const body = joinSourceChunksWithoutOverlap(list);
    const block = blockHead + body + `\n<<<END SOURCE: ${src.relPath}>>>\n`;
    parts.push(block);
  }

  return parts.join("");
}

export function buildKpiEvidenceFromSelectedChunks(project: CreditMemoProject, selected: SourceChunkRecord[]): string {
  return buildRankedChunkEvidencePack(project, selected, "retrieval — top chunks for KPI query");
}

export type CreditMemoEvidenceDiagnostics = {
  mode: "retrieval" | "sequential_fallback";
  ingestChunkMaxChars: number;
  ingestChunkOverlapChars: number;
  projectChunkCount: number;
  nonEmptyChunkCount: number;
  /** Sum of `charExtracted` for non-skipped source files (ingest). */
  rawSourceCharsSum: number;
  evidenceCharCap: number;
  evidencePackChars: number;
  retrievalQueryChars: number;
  queryEmbeddedChars: number;
  fallbackReason?: "retrieval_disabled" | "no_embedding_key" | "no_user" | "no_chunks" | "embed_failed" | "empty_window" | "error";
  /** Human-readable detail when fallbackReason is embed_failed or error. */
  fallbackDetail?: string;
  embeddingProvider?: KpiEmbeddingProviderId;
  embeddingModel?: string;
  embeddingDimensions?: number;
  chunksEmbedded?: number;
  /** Max chunks considered for embedding (MEMO_EMBED_MAX_CHUNKS). */
  chunksEmbedCap?: number;
  corpusChunksWereCapped?: boolean;
  chunksInWindow?: number;
  rankingQueryLines: string[];
  documentsInWindow: Array<{ relPath: string; chunkCount: number }>;
  /** Per indexed file: available text, chars packed into the last context window, chunk count. */
  sourceRows: Array<{
    relPath: string;
    charsAvailable: number;
    packedChars: number;
    chunksInWindow: number;
  }>;
};

export type CreditMemoEvidencePackResult = {
  evidence: string;
  retrievalUsed: boolean;
  diagnostics: CreditMemoEvidenceDiagnostics;
};

function projectRawSourceCharsSum(project: CreditMemoProject): number {
  return project.sources
    .filter((s) => s.parseStatus !== "skipped")
    .reduce((a, s) => a + s.charExtracted, 0);
}

function rankingQueryLinesFromMemoQuery(query: string): string[] {
  return query.split("\n").map((l) => l.trim()).filter(Boolean);
}

function documentsInWindowFromPicked(
  project: CreditMemoProject,
  picked: SourceChunkRecord[]
): Array<{ relPath: string; chunkCount: number }> {
  const m = new Map<string, number>();
  const byId = new Map(project.sources.map((s) => [s.id, s]));
  for (const c of picked) {
    const s = byId.get(c.sourceFileId);
    if (!s) continue;
    m.set(s.relPath, (m.get(s.relPath) ?? 0) + 1);
  }
  return [...m.entries()]
    .map(([relPath, chunkCount]) => ({ relPath, chunkCount }))
    .sort((a, b) => b.chunkCount - a.chunkCount || a.relPath.localeCompare(b.relPath, undefined, { sensitivity: "base" }));
}

/**
 * Try embedding-ranked chunks (memo title + outline as query); fall back to sequential `buildEvidencePackSync`.
 * Uses the same `credit-memo/kpi-embeddings/{projectId}.json` cache as future KPI-on-project flows.
 */
export async function resolveCreditMemoEvidencePack(params: {
  userId: string;
  project: CreditMemoProject;
  apiKeys: LlmCallApiKeys;
  query: string;
}): Promise<CreditMemoEvidencePackResult> {
  const { userId, project, apiKeys, query } = params;
  const nonEmptyChunkCount = project.chunks.filter((c) => c.text.trim().length > 0).length;
  const qLen = query.length;
  const qEmb = Math.min(30_000, qLen);
  const lines = rankingQueryLinesFromMemoQuery(query);
  const rawSourceCharsSum = projectRawSourceCharsSum(project);
  const seqFallback = (
    evidence: string,
    reason: NonNullable<CreditMemoEvidenceDiagnostics["fallbackReason"]>,
    detail?: string
  ): CreditMemoEvidencePackResult => {
    const cap = memoFallbackMaxEvidenceChars();
    return {
      evidence,
      retrievalUsed: false,
      diagnostics: {
        mode: "sequential_fallback",
        ingestChunkMaxChars: CREDIT_MEMO_CHUNK_MAX_CHARS,
        ingestChunkOverlapChars: CREDIT_MEMO_CHUNK_OVERLAP_CHARS,
        projectChunkCount: project.chunks.length,
        nonEmptyChunkCount,
        rawSourceCharsSum,
        evidenceCharCap: cap,
        evidencePackChars: evidence.length,
        retrievalQueryChars: qLen,
        queryEmbeddedChars: qEmb,
        fallbackReason: reason,
        fallbackDetail: detail,
        rankingQueryLines: lines,
        documentsInWindow: [],
        sourceRows: computeMemoEvidenceSourceRows(project, evidence),
      },
    };
  };

  if (!isMemoRetrievalEnabled()) {
    const evidence = buildEvidencePackSync(project, {
      maxChars: memoFallbackMaxEvidenceChars(),
      query,
      memoDeckOrder: true,
    });
    return seqFallback(evidence, "retrieval_disabled");
  }
  if (!userId) {
    const evidence = buildEvidencePackSync(project, {
      maxChars: memoFallbackMaxEvidenceChars(),
      query,
      memoDeckOrder: true,
    });
    return seqFallback(evidence, "no_user");
  }
  if (!hasAnyKpiEmbeddingKey(apiKeys)) {
    const evidence = buildEvidencePackSync(project, {
      maxChars: memoFallbackMaxEvidenceChars(),
      query,
      memoDeckOrder: true,
    });
    return seqFallback(evidence, "no_embedding_key");
  }
  if (nonEmptyChunkCount === 0) {
    const evidence = buildEvidencePackSync(project, {
      maxChars: memoFallbackMaxEvidenceChars(),
      query,
      memoDeckOrder: true,
    });
    return seqFallback(evidence, "no_chunks");
  }

  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);

  try {
    const embedResult = await ensureKpiChunkEmbeddings(userId, project, apiKeys);
    const vectors = embedResult.vectors;
    const qVec = await embedCreditMemoRetrievalQuery(query, apiKeys);
    if (!vectors || !qVec) {
      const evidence = buildEvidencePackSync(project, {
        maxChars: memoFallbackMaxEvidenceChars(),
        query,
        memoDeckOrder: true,
      });
      return seqFallback(
        evidence,
        "embed_failed",
        embedResult.error ?? (qVec ? undefined : "Query embedding returned no vector.")
      );
    }
    const cap = memoRetrievalMaxEvidenceChars();
    const picked = selectChunksForKpiEvidence(project, vectors, qVec, cap);
    const chunksEmbedded = embedResult.chunksEmbedded ?? Object.keys(vectors).length;
    if (picked.length === 0) {
      const evidence = buildEvidencePackSync(project, {
        maxChars: memoFallbackMaxEvidenceChars(),
        query,
        memoDeckOrder: true,
      });
      return seqFallback(evidence, "empty_window");
    }
    const evidence = buildRankedChunkEvidencePack(
      project,
      picked,
      "retrieval — ranked chunks for credit memo / deck outline (embeddings)"
    );
    const docsInWindow = documentsInWindowFromPicked(project, picked);
    const chunkCountsByPath = new Map(docsInWindow.map((d) => [d.relPath, d.chunkCount]));
    return {
      evidence,
      retrievalUsed: true,
      diagnostics: {
        mode: "retrieval",
        ingestChunkMaxChars: CREDIT_MEMO_CHUNK_MAX_CHARS,
        ingestChunkOverlapChars: CREDIT_MEMO_CHUNK_OVERLAP_CHARS,
        projectChunkCount: project.chunks.length,
        nonEmptyChunkCount,
        rawSourceCharsSum,
        evidenceCharCap: cap,
        evidencePackChars: evidence.length,
        retrievalQueryChars: qLen,
        queryEmbeddedChars: qEmb,
        rankingQueryLines: lines,
        documentsInWindow: docsInWindow,
        sourceRows: computeMemoEvidenceSourceRows(project, evidence, chunkCountsByPath),
        embeddingProvider: backend?.provider,
        embeddingModel: backend?.model,
        embeddingDimensions: backend?.dimensions,
        chunksEmbedded,
        chunksEmbedCap: embedResult.chunksEmbedCap,
        corpusChunksWereCapped: embedResult.corpusChunksWereCapped,
        chunksInWindow: picked.length,
      },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[memoRetrieval] ranked pack failed:", msg);
    const evidence = buildEvidencePackSync(project, {
      maxChars: memoFallbackMaxEvidenceChars(),
      query,
      memoDeckOrder: true,
    });
    return seqFallback(evidence, "error", msg.slice(0, 500));
  }
}
