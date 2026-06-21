/**
 * LME context retrieval: chunk long sources, embed with OpenAI/Gemini/DeepSeek (same stack as KPI),
 * rank by cosine similarity to an LME-focused query, greedy-pack into a character budget.
 */

import { createHash } from "crypto";

import { embedTextsForKpiRetrieval, resolveKpiEmbeddingBackendMetadata } from "@/lib/kpi-embedding-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { DEFAULT_EMBEDDING_DIMENSIONS, DEFAULT_EMBEDDING_MODEL } from "@/lib/openai-embeddings";
import { FORENSIC_RETRIEVAL_QUERY } from "@/data/forensic-accounting-prompt";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { workspaceReadUtf8, workspaceWriteUtf8 } from "@/lib/user-ticker-workspace-store";
import { joinIndexedTextSlicesWithoutOverlap } from "@/lib/creditMemo/chunkStitch";

const STORAGE_PREFIX = "credit-memo/lme-retrieval-embeddings";

function embeddingsRelPath(ticker: string): string {
  const tk = sanitizeTicker(ticker);
  return `${STORAGE_PREFIX}/${tk}.json`;
}

export const LME_RETRIEVAL_QUERY = [
  "liability management LME debt maturity refi amend extend exchange consent covenant waiver springing",
  "credit agreement indenture collateral security liquidity runway covenant basket step-down maturity wall",
  "SEC filing 10-K 10-Q 8-K exhibit indenture supplemental trustee",
  "earnings call transcript prepared remarks guidance leverage free cash flow",
  "investor presentation non-deal roadshow slide deck capital allocation",
].join("\n");

/** Embedding query for KPI commentary runs (workspace sources pack). */
export const KPI_COMMENTARY_RETRIEVAL_QUERY = [
  "KPI commentary operating metrics revenue gross margin EBITDA adjusted EBITDA free cash flow liquidity",
  "segment results geographic mix same-store sales volume price mix guidance outlook assumptions",
  "non-GAAP reconciliation adjustments restructuring impairments one-time charges stock comp",
  "working capital inventory receivables payables capex maintenance growth investments",
  "earnings call transcript management presentation prepared remarks Q&A outlook",
  "MD&A risk factors critical accounting estimates controls segment footnotes tables",
].join("\n");

/** Embedding query for creative Work Product tabs (literary, biblical, shorting, earnings transcript). */
export const CREATIVE_WORKSPACE_RETRIEVAL_QUERY = [
  "credit analysis investment thesis risk reward leverage liquidity covenant maturity",
  "KPI operating metrics revenue margin EBITDA free cash flow guidance segment outlook",
  "forensic accounting controls revenue recognition working capital quality of earnings",
  "LME debt refinance amend extend exchange consent waiver restructuring liability management",
  "earnings call transcript prepared remarks Q&A management outlook strategy capital allocation",
  "capital structure recommendation protection downside recovery scenario distressed bear case",
  "AI credit memo deck narrative management credibility turnaround restructuring industry dynamics",
].join("\n");

export type LmeRetrievalPackTask = "lme" | "kpi" | "forensic" | "creative";

export function retrievalQueryForTask(task: LmeRetrievalPackTask): string {
  if (task === "kpi") return KPI_COMMENTARY_RETRIEVAL_QUERY;
  if (task === "forensic") return FORENSIC_RETRIEVAL_QUERY;
  if (task === "creative") return CREATIVE_WORKSPACE_RETRIEVAL_QUERY;
  return LME_RETRIEVAL_QUERY;
}

function parseEnvInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function lmeChunkSizeChars(): number {
  return parseEnvInt("LME_CHUNK_CHARS", 3_500, 800, 28_000);
}

export function lmeChunkOverlapChars(): number {
  return parseEnvInt("LME_CHUNK_OVERLAP", 400, 0, 4_000);
}

export function lmeFullInlineMaxChars(): number {
  return parseEnvInt("LME_FULL_INLINE_MAX_CHARS", 140_000, 2_000, 600_000);
}

export function lmeMaxChunksPerDocument(): number {
  return parseEnvInt("LME_MAX_CHUNKS_PER_DOC", 14, 4, 80);
}

/** Cap total chunks embedded in one global ranked pack (corpus order; earlier sources win if truncated). */
export function lmeGlobalRankMaxChunks(): number {
  return parseEnvInt("LME_GLOBAL_RANK_MAX_CHUNKS", 3_000, 200, 25_000);
}

/**
 * When the corpus exceeds `maxChunks`, keep at least one chunk per document in the embed
 * batch so user-added / late sources are not excluded from embedding entirely.
 */
export function capLmeChunksPreservingEachDocument(
  chunks: LmeIndexedChunk[],
  maxChunks: number
): { capped: LmeIndexedChunk[]; corpusChunksWereCapped: boolean } {
  if (chunks.length <= maxChunks) {
    return { capped: chunks, corpusChunksWereCapped: false };
  }

  const byDoc = new Map<string, LmeIndexedChunk[]>();
  for (const c of chunks) {
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, []);
    byDoc.get(c.docId)!.push(c);
  }

  const reserved: LmeIndexedChunk[] = [];
  const reservedIds = new Set<string>();
  for (const docChunks of byDoc.values()) {
    docChunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const first = docChunks[0]!;
    if (!reservedIds.has(first.id)) {
      reserved.push(first);
      reservedIds.add(first.id);
    }
  }

  if (reserved.length >= maxChunks) {
    return { capped: reserved.slice(0, maxChunks), corpusChunksWereCapped: true };
  }

  const tail: LmeIndexedChunk[] = [];
  for (const c of chunks) {
    if (!reservedIds.has(c.id)) tail.push(c);
  }

  return {
    capped: [...reserved, ...tail.slice(0, maxChunks - reserved.length)],
    corpusChunksWereCapped: true,
  };
}

/** Max chunks per document in the global ranked pack (diversity vs depth). */
export function lmeGlobalMaxChunksPerDocument(): number {
  return parseEnvInt("LME_GLOBAL_MAX_CHUNKS_PER_DOC", 40, 4, 200);
}

/** KPI tab: max chunks from a user-added extra-ingest document (Extra ingestion sources picker). */
export function kpiExtraIngestMaxChunksPerDocument(): number {
  return parseEnvInt("KPI_EXTRA_INGEST_MAX_CHUNKS_PER_DOC", 5, 1, 20);
}

/** KPI tab: max chars when sequential fallback packs a user-added / credit-agreement extra. */
export function kpiExtraIngestMaxPartChars(): number {
  return parseEnvInt("KPI_EXTRA_INGEST_MAX_PART_CHARS", 20_000, 2_000, 80_000);
}

/** KPI tab: max chunks when an extra-ingest filename looks like a credit agreement / exhibit 10.x. */
export function kpiCreditDocExtraIngestMaxChunksPerDocument(): number {
  return parseEnvInt("KPI_CREDIT_DOC_EXTRA_MAX_CHUNKS_PER_DOC", 3, 1, 10);
}

/** Embedding-ranked chunk windows by default; set `LME_RETRIEVAL=0` to force sequential pack. */
export function isLmeRetrievalEnabled(): boolean {
  const v = process.env.LME_RETRIEVAL?.trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off") return false;
  return true;
}

export type LmeIndexedChunk = {
  id: string;
  docId: string;
  label: string;
  chunkIndex: number;
  chunkCount: number;
  text: string;
};

function fingerprintForChunks(chunks: LmeIndexedChunk[]): string {
  const lines = chunks.map((c) => `${c.id}\t${createHash("sha256").update(c.text).digest("hex").slice(0, 20)}`);
  lines.sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

export function buildLmeChunksForDocument(docId: string, label: string, fullText: string): LmeIndexedChunk[] {
  const chunkSize = lmeChunkSizeChars();
  const overlap = Math.min(lmeChunkOverlapChars(), Math.floor(chunkSize / 2));
  const t = fullText;
  if (!t.trim()) return [];
  const out: LmeIndexedChunk[] = [];
  let start = 0;
  let idx = 0;
  for (;;) {
    const end = Math.min(t.length, start + chunkSize);
    const piece = t.slice(start, end);
    out.push({
      id: `${docId}:${idx}`,
      docId,
      label,
      chunkIndex: idx,
      chunkCount: -1,
      text: piece,
    });
    idx++;
    if (end >= t.length) break;
    const next = end - overlap;
    start = next > start ? next : end;
  }
  const n = out.length;
  for (const c of out) c.chunkCount = n;
  return out;
}

type StoredLmeEmbeddings = {
  embeddingProvider?: string;
  embeddingModel: string;
  dimensions: number;
  fingerprint: string;
  vectors: Record<string, number[]>;
};

function l2normalize(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}

async function loadStoredEmbeddings(userId: string, ticker: string): Promise<StoredLmeEmbeddings | null> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return null;
  const raw = await workspaceReadUtf8(userId, sym, embeddingsRelPath(ticker));
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as StoredLmeEmbeddings;
  } catch {
    return null;
  }
}

async function saveStoredEmbeddings(userId: string, ticker: string, data: StoredLmeEmbeddings): Promise<void> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return;
  const w = await workspaceWriteUtf8(userId, sym, embeddingsRelPath(ticker), JSON.stringify(data, null, 0));
  if (!w.ok) throw new Error(w.error);
}

/**
 * Embed all chunks; uses workspace cache when fingerprint matches backend + chunk hashes.
 */
export async function ensureLmeRetrievalEmbeddings(
  userId: string,
  ticker: string,
  chunks: LmeIndexedChunk[],
  apiKeys: LlmCallApiKeys | undefined
): Promise<Record<string, number[]> | null> {
  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);
  if (!backend || chunks.length === 0) return null;

  const fp = fingerprintForChunks(chunks);
  const existing = await loadStoredEmbeddings(userId, ticker);
  if (
    existing &&
    existing.fingerprint === fp &&
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
    batchSize: 48,
  });
  if (!res.ok) {
    console.error("[lme-retrieval] embedding failed:", res.error);
    return null;
  }

  const vectors: Record<string, number[]> = {};
  chunks.forEach((c, i) => {
    vectors[c.id] = res.vectors[i]!;
  });

  try {
    await saveStoredEmbeddings(userId, ticker, {
      fingerprint: fp,
      embeddingProvider: res.provider,
      embeddingModel: res.model,
      dimensions: res.dimensions,
      vectors,
    });
  } catch (e) {
    console.warn("[lme-retrieval] cache write failed:", e);
  }

  return vectors;
}

export async function embedRetrievalQueryForTask(
  task: LmeRetrievalPackTask,
  apiKeys: LlmCallApiKeys | undefined
): Promise<number[] | null> {
  const res = await embedTextsForKpiRetrieval([retrievalQueryForTask(task)], apiKeys, {
    model: DEFAULT_EMBEDDING_MODEL,
    dimensions: DEFAULT_EMBEDDING_DIMENSIONS,
    batchSize: 1,
  });
  if (!res.ok || !res.vectors[0]) return null;
  return res.vectors[0];
}

export async function embedLmeRetrievalQuery(apiKeys: LlmCallApiKeys | undefined): Promise<number[] | null> {
  return embedRetrievalQueryForTask("lme", apiKeys);
}

/**
 * Pack highest-scoring chunks until budgetChars.
 * Phase 1 reserves each document's best-scoring chunk so no source is omitted entirely.
 * Phase 2 fills remaining budget by score up to maxPerDoc per document.
 */
export function selectLmeChunksForBudget(
  queryVec: number[],
  chunks: LmeIndexedChunk[],
  vectors: Record<string, number[]>,
  budgetChars: number,
  maxPerDoc: number,
  task: LmeRetrievalPackTask = "lme",
  resolveMaxPerDoc: (docId: string) => number = () => maxPerDoc
): LmeIndexedChunk[] {
  const q = l2normalize(queryVec);
  const scored: { chunk: LmeIndexedChunk; score: number }[] = [];
  const bestByDoc = new Map<string, { chunk: LmeIndexedChunk; score: number }>();
  for (const c of chunks) {
    const v = vectors[c.id];
    if (!v?.length) continue;
    const score = dot(q, l2normalize(v));
    scored.push({ chunk: c, score });
    const prev = bestByDoc.get(c.docId);
    if (!prev || score > prev.score) bestByDoc.set(c.docId, { chunk: c, score });
  }
  scored.sort((a, b) => b.score - a.score);

  const picked: LmeIndexedChunk[] = [];
  const pickedIds = new Set<string>();
  let used = 0;
  const perDoc = new Map<string, number>();

  const tryPick = (chunk: LmeIndexedChunk, ignoreBudget = false): boolean => {
    if (pickedIds.has(chunk.id)) return false;
    const n = perDoc.get(chunk.docId) ?? 0;
    if (n >= resolveMaxPerDoc(chunk.docId)) return false;
    const block = formatChunkBlock(chunk, task);
    if (!ignoreBudget && used + block.length > budgetChars && picked.length > 0) return false;
    picked.push(chunk);
    pickedIds.add(chunk.id);
    perDoc.set(chunk.docId, n + 1);
    used += block.length;
    return true;
  };

  const docOrder = [...new Set(chunks.map((c) => c.docId))];
  for (const docId of docOrder) {
    const best = bestByDoc.get(docId);
    if (best) tryPick(best.chunk, true);
  }

  for (const { chunk } of scored) {
    if (pickedIds.has(chunk.id)) continue;
    const n = perDoc.get(chunk.docId) ?? 0;
    if (n >= resolveMaxPerDoc(chunk.docId)) continue;
    const block = formatChunkBlock(chunk, task);
    if (used + block.length > budgetChars && picked.length > 0) break;
    tryPick(chunk);
  }

  return picked;
}

function formatChunkBlock(c: LmeIndexedChunk, task: LmeRetrievalPackTask): string {
  const tag =
    task === "kpi"
      ? "KPI RETRIEVAL"
      : task === "forensic"
        ? "FORENSIC RETRIEVAL"
        : task === "creative"
          ? "WORK PRODUCT RETRIEVAL"
          : "LME RETRIEVAL";
  const head = `<<<${tag} | ${c.label} | part ${c.chunkIndex + 1}/${c.chunkCount}>>>\n`;
  return head + c.text;
}

export function formatRetrievedChunksForPrompt(picked: LmeIndexedChunk[], task: LmeRetrievalPackTask = "lme"): string {
  if (!picked.length) return "";
  const tag =
    task === "kpi"
      ? "KPI RETRIEVAL"
      : task === "forensic"
        ? "FORENSIC RETRIEVAL"
        : task === "creative"
          ? "WORK PRODUCT RETRIEVAL"
          : "LME RETRIEVAL";
  const intro =
    task === "kpi"
      ? "# RETRIEVED SOURCE FRAGMENTS (ranked for KPI / operating and financial commentary)\nEach ingested source contributes at least one excerpt; additional space is filled by embedding similarity to the KPI commentary task.\n\n"
      : task === "forensic"
        ? "# RETRIEVED SOURCE FRAGMENTS (ranked for forensic accounting / financial statement review)\nEach ingested source contributes at least one excerpt; additional space is filled by embedding similarity to the forensic accounting task.\n\n"
        : task === "creative"
          ? "# RETRIEVED SOURCE FRAGMENTS (ranked for creative Work Product tabs)\nEach ingested source contributes at least one excerpt; additional space is filled by embedding similarity to the Work Product synthesis task.\n\n"
          : "# RETRIEVED SOURCE FRAGMENTS (ranked for LME / liability-management relevance)\nEach ingested source contributes at least one excerpt; additional space is filled by embedding similarity to the LME task.\n\n";

  const byDoc = new Map<string, LmeIndexedChunk[]>();
  for (const c of picked) {
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, []);
    byDoc.get(c.docId)!.push(c);
  }

  const overlap = lmeChunkOverlapChars();
  const blocks: string[] = [];
  for (const chunks of byDoc.values()) {
    chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);
    const label = chunks[0]!.label;
    const body = joinIndexedTextSlicesWithoutOverlap(
      chunks.map((c) => ({ chunkIndex: c.chunkIndex, text: c.text })),
      overlap,
      "\n\n---\n\n"
    );
    const head = `<<<${tag} | ${label} | ${chunks.length} excerpt(s)>>>\n`;
    blocks.push(head + body);
  }
  return intro + blocks.join("\n\n---\n\n");
}
