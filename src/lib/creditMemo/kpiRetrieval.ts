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
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import {
  workspaceDeleteFile,
  workspaceReadUtf8,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "@/lib/openai-embeddings";
import {
  embedTextsForKpiRetrieval,
  hasAnyKpiEmbeddingKey,
  resolveKpiEmbeddingBackendMetadata,
  type KpiEmbeddingProviderId,
} from "@/lib/kpi-embedding-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import type { CreditMemoProject, SourceChunkRecord } from "./types";
import { buildEvidencePackSync } from "./evidencePack";
import { sortSourcesForEvidence } from "./memoPlanner";
import { CREDIT_MEMO_CHUNK_MAX_CHARS, CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";

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
};

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
 * AI Memo & Deck: chunk embeddings + cosine-ranked evidence pack (same stack as LME/KPI — OpenAI / Gemini / DeepSeek).
 * Set `MEMO_RETRIEVAL=0` to use sequential packing only (`MEMO_FALLBACK_MAX_EVIDENCE_CHARS` cap).
 */
export function isMemoRetrievalEnabled(): boolean {
  const v = process.env.MEMO_RETRIEVAL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

/** Ranked chunk body budget for memo/deck when retrieval succeeds (framing lines add a little on top). */
export function memoRetrievalMaxEvidenceChars(): number {
  return parseEnvInt("MEMO_RETRIEVAL_MAX_EVIDENCE_CHARS", 520_000, 20_000, 2_000_000);
}

/** Sequential evidence cap when retrieval is off, disabled, or fails (aligns with LME-style bundle scale). */
export function memoFallbackMaxEvidenceChars(): number {
  return parseEnvInt("MEMO_FALLBACK_MAX_EVIDENCE_CHARS", 520_000, 40_000, 2_000_000);
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
  /** Embedding API calls can run many minutes with no DB traffic; pooled TLS sockets may be dead. Warm before the large upsert. */
  try {
    await prisma.$connect();
  } catch {
    /* write path will surface real errors */
  }
  const w = await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, storagePath(projectId), json);
  if (!w.ok) throw new Error(w.error);
}

export async function deleteKpiEmbeddingsFile(userId: string, projectId: string): Promise<void> {
  await workspaceDeleteFile(userId, WORKSPACE_GLOBAL_TICKER, storagePath(projectId));
}

/**
 * Ensure we have one embedding vector per chunk (keyed by chunk id). Recomputes when project
 * `updatedAt` changes or counts mismatch.
 */
export async function ensureKpiChunkEmbeddings(
  userId: string,
  project: CreditMemoProject,
  apiKeys: LlmCallApiKeys | undefined
): Promise<Record<string, number[]> | null> {
  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);
  if (!backend) return null;

  const chunks = project.chunks.filter((c) => c.text.trim().length > 0);
  if (chunks.length === 0) return null;

  const existing = await loadStored(userId, project.id);
  if (
    existing &&
    existing.projectUpdatedAt === project.updatedAt &&
    existing.dimensions === backend.dimensions &&
    (existing.embeddingProvider ?? "openai") === backend.provider &&
    existing.embeddingModel === backend.model &&
    chunks.every((c) => existing.vectors[c.id]?.length)
  ) {
    return existing.vectors;
  }

  const texts = chunks.map((c) => c.text.slice(0, 30_000));
  const res = await embedTextsForKpiRetrieval(texts, apiKeys, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    batchSize: 64,
  });
  if (!res.ok) {
    console.error("[kpiRetrieval] embedding failed:", res.error);
    return null;
  }

  const vectors: Record<string, number[]> = {};
  chunks.forEach((c, i) => {
    vectors[c.id] = res.vectors[i]!;
  });

  await saveStored(userId, project.id, {
    embeddingProvider: res.provider,
    embeddingModel: res.model,
    dimensions: res.dimensions,
    projectUpdatedAt: project.updatedAt,
    vectors,
  });

  return vectors;
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
 * Pick chunks by cosine similarity to queryVec, then greedily pack by score until maxChars
 * (including synthetic block overhead).
 */
export function selectChunksForKpiEvidence(
  project: CreditMemoProject,
  vectors: Record<string, number[]>,
  queryVec: number[],
  maxEvidenceChars: number
): SourceChunkRecord[] {
  const q = l2normalize(queryVec);
  const scored: { chunk: SourceChunkRecord; score: number }[] = [];
  for (const c of project.chunks) {
    const v = vectors[c.id];
    if (!v?.length) continue;
    const s = dot(q, l2normalize(v));
    scored.push({ chunk: c, score: s });
  }
  scored.sort((a, b) => b.score - a.score);

  const picked: SourceChunkRecord[] = [];
  let used = 0;
  const overheadPerBlock = 120;
  for (const { chunk } of scored) {
    const add = chunk.text.length + overheadPerBlock;
    if (used + add > maxEvidenceChars && picked.length > 0) break;
    picked.push(chunk);
    used += add;
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
    const body = list.map((c) => c.text).join("\n\n--- chunk ---\n\n");
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
  embeddingProvider?: KpiEmbeddingProviderId;
  embeddingModel?: string;
  embeddingDimensions?: number;
  chunksEmbedded?: number;
  chunksInWindow?: number;
  rankingQueryLines: string[];
  documentsInWindow: Array<{ relPath: string; chunkCount: number }>;
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
  const seqFallback = (evidence: string, reason: NonNullable<CreditMemoEvidenceDiagnostics["fallbackReason"]>): CreditMemoEvidencePackResult => {
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
        rankingQueryLines: lines,
        documentsInWindow: [],
      },
    };
  };

  if (!isMemoRetrievalEnabled()) {
    const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
    return seqFallback(evidence, "retrieval_disabled");
  }
  if (!userId) {
    const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
    return seqFallback(evidence, "no_user");
  }
  if (!hasAnyKpiEmbeddingKey(apiKeys)) {
    const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
    return seqFallback(evidence, "no_embedding_key");
  }
  if (nonEmptyChunkCount === 0) {
    const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
    return seqFallback(evidence, "no_chunks");
  }

  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);

  try {
    const vectors = await ensureKpiChunkEmbeddings(userId, project, apiKeys);
    const qVec = await embedCreditMemoRetrievalQuery(query, apiKeys);
    if (!vectors || !qVec) {
      const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
      return seqFallback(evidence, "embed_failed");
    }
    const cap = memoRetrievalMaxEvidenceChars();
    const picked = selectChunksForKpiEvidence(project, vectors, qVec, cap);
    const chunksEmbedded = Object.keys(vectors).length;
    if (picked.length === 0) {
      const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
      return seqFallback(evidence, "empty_window");
    }
    const evidence = buildRankedChunkEvidencePack(
      project,
      picked,
      "retrieval — ranked chunks for credit memo / deck outline (embeddings)"
    );
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
        documentsInWindow: documentsInWindowFromPicked(project, picked),
        embeddingProvider: backend?.provider,
        embeddingModel: backend?.model,
        embeddingDimensions: backend?.dimensions,
        chunksEmbedded,
        chunksInWindow: picked.length,
      },
    };
  } catch (e) {
    console.error("[memoRetrieval] ranked pack failed:", e instanceof Error ? e.message : e);
    const evidence = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), query });
    return seqFallback(evidence, "error");
  }
}
