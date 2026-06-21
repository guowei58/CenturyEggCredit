/**
 * Replay KPI retrieval using stored workspace embedding cache (no API calls).
 * Usage: npx tsx scripts/diag-kpi-retrieval-exhibit-replay.ts GEN a7116exhibit403
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import {
  buildLmeChunksForDocument,
  embedRetrievalQueryForTask,
  lmeChunkSizeChars,
  lmeGlobalMaxChunksPerDocument,
  lmeGlobalRankMaxChunks,
  selectLmeChunksForBudget,
  retrievalQueryForTask,
  type LmeIndexedChunk,
} from "../src/lib/lme-retrieval";
import { LME_DEFAULT_BUNDLE_CHAR_CAP } from "../src/lib/lme-sources";
import { workspaceReadUtf8 } from "../src/lib/user-ticker-workspace-store";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { createHash } from "crypto";

const ticker = (process.argv[2] ?? "GEN").trim().toUpperCase();
const fileNeedle = (process.argv[3] ?? "a7116exhibit403").trim().toLowerCase();

function fingerprintForChunks(chunks: LmeIndexedChunk[]): string {
  const lines = chunks.map((c) => `${c.id}\t${createHash("sha256").update(c.text).digest("hex").slice(0, 20)}`);
  lines.sort();
  return createHash("sha256").update(lines.join("\n")).digest("hex").slice(0, 32);
}

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

function chunkTextChars(picked: LmeIndexedChunk[]): number {
  return picked.reduce((s, c) => s + c.text.length, 0);
}

async function main() {
  const docRow = await prisma.userSavedDocument.findFirst({
    where: { ticker, filename: { contains: fileNeedle, mode: "insensitive" } },
    select: { userId: true },
  });
  if (!docRow) {
    console.error("Document not found");
    process.exit(1);
  }
  const userId = docRow.userId;

  const cacheRaw = await workspaceReadUtf8(userId, ticker, `credit-memo/lme-retrieval-embeddings/${ticker}.json`);
  if (!cacheRaw?.trim()) {
    console.error("No embedding cache found — build context window once in the app first.");
    process.exit(1);
  }
  const cache = JSON.parse(cacheRaw) as {
    fingerprint: string;
    embeddingProvider?: string;
    embeddingModel?: string;
    vectors: Record<string, number[]>;
  };

  const rawDocs = await collectWorkProductRawDocumentsWithAdditions("kpi", ticker, userId, () =>
    collectKpiCommentaryRawDocuments(ticker, userId)
  );
  const target = rawDocs.find(
    (d) => d.file?.toLowerCase().includes(fileNeedle) || d.label.toLowerCase().includes(fileNeedle)
  );

  const allChunks = rawDocs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
  const capped = allChunks.slice(0, lmeGlobalRankMaxChunks());
  const fp = fingerprintForChunks(capped);

  console.log(`Ticker: ${ticker}`);
  console.log(`Corpus docs: ${rawDocs.length}, chunks: ${allChunks.length}, embedded cap: ${capped.length}`);
  console.log(`Cache: provider=${cache.embeddingProvider} model=${cache.embeddingModel} vectors=${Object.keys(cache.vectors).length}`);
  console.log(`Fingerprint match: ${fp === cache.fingerprint ? "YES" : "NO"} (current=${fp.slice(0, 12)} cache=${cache.fingerprint.slice(0, 12)})`);

  if (fp !== cache.fingerprint) {
    console.error("\nCache is stale vs current corpus — re-build context window in app, then re-run this script.");
    process.exit(1);
  }

  const vectors = cache.vectors;
  const missing = capped.filter((c) => !vectors[c.id]?.length);
  if (missing.length) {
    console.error(`Cache missing ${missing.length} chunk vectors`);
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const prefs = await getUserPreferences(userId);
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(buildLlmApiKeyBundle(user?.email, prefs));
  const qVec = await embedRetrievalQueryForTask("kpi", apiKeys);
  if (!qVec) {
    console.error("Could not embed KPI query (need a working embedding API key in user prefs/env).");
    process.exit(1);
  }

  const q = l2normalize(qVec);
  const scored: { chunk: LmeIndexedChunk; score: number }[] = [];
  const byDocBest = new Map<string, number>();
  for (const c of capped) {
    const v = vectors[c.id]!;
    const score = dot(q, l2normalize(v));
    scored.push({ chunk: c, score });
    const prev = byDocBest.get(c.docId);
    if (prev == null || score > prev) byDocBest.set(c.docId, score);
  }
  scored.sort((a, b) => b.score - a.score);

  const docRank = [...byDocBest.entries()]
    .map(([docId, best]) => {
      const meta = rawDocs.find((d) => d.docId === docId);
      return { docId, label: meta?.label ?? docId, best };
    })
    .sort((a, b) => b.best - a.best);

  console.log("\n=== Documents by best chunk cosine score (cached vectors) ===");
  for (const row of docRank.slice(0, 15)) {
    const mark = row.label.toLowerCase().includes(fileNeedle) ? " <-- TARGET" : "";
    console.log(`  ${row.best.toFixed(4)}  ${row.label}${mark}`);
  }

  const maxPerDoc = lmeGlobalMaxChunksPerDocument();
  const budget = LME_DEFAULT_BUNDLE_CHAR_CAP;
  const picked = selectLmeChunksForBudget(q, capped, vectors, budget, maxPerDoc, "kpi");

  const byDocPicked = new Map<string, LmeIndexedChunk[]>();
  for (const c of picked) {
    if (!byDocPicked.has(c.docId)) byDocPicked.set(c.docId, []);
    byDocPicked.get(c.docId)!.push(c);
  }

  console.log(`\n=== selectLmeChunksForBudget (budget=${budget}, maxPerDoc=${maxPerDoc}, chunkSize=${lmeChunkSizeChars()}) ===`);
  console.log(`Total picked: ${picked.length} chunks, ${chunkTextChars(picked).toLocaleString()} text chars\n`);

  const packedRows = [...byDocPicked.entries()]
    .map(([docId, chunks]) => {
      const meta = rawDocs.find((d) => d.docId === docId);
      return {
        label: meta?.label ?? docId,
        chunks: chunks.length,
        textChars: chunkTextChars(chunks),
        best: byDocBest.get(docId) ?? 0,
      };
    })
    .sort((a, b) => b.textChars - a.textChars);

  for (const row of packedRows) {
    const mark = row.label.toLowerCase().includes(fileNeedle) ? " <-- TARGET" : "";
    console.log(
      `  ${String(row.chunks).padStart(2)} chunks  ${row.textChars.toLocaleString().padStart(9)} chars  best=${row.best.toFixed(4)}  ${row.label}${mark}`
    );
  }

  if (target) {
    const tPicked = byDocPicked.get(target.docId) ?? [];
    const tRank = docRank.findIndex((r) => r.docId === target.docId) + 1;
    const tChunksTotal = capped.filter((c) => c.docId === target.docId).length;
    console.log("\n=== TARGET (exact) ===");
    console.log(`Label: ${target.label}`);
    console.log(`Raw chars: ${target.raw.length.toLocaleString()}`);
    console.log(`Chunks in corpus: ${tChunksTotal}`);
    console.log(`Doc rank by best chunk score: ${tRank} / ${docRank.length}`);
    console.log(`Best chunk score: ${(byDocBest.get(target.docId) ?? 0).toFixed(4)}`);
    console.log(`Chunks picked: ${tPicked.length} (cap maxPerDoc=${maxPerDoc})`);
    console.log(`Packed text chars (UI In context): ${chunkTextChars(tPicked).toLocaleString()}`);
    if (tPicked.length >= maxPerDoc) {
      console.log(`REASON: hit LME_GLOBAL_MAX_CHUNKS_PER_DOC=${maxPerDoc} — not random; packer stopped adding chunks from this doc.`);
    }
    const topGlobal = scored.slice(0, 5).map((s) => ({
      score: s.score.toFixed(4),
      label: s.chunk.label,
      idx: s.chunk.chunkIndex,
    }));
    console.log("\nTop 5 chunks globally:");
    for (const t of topGlobal) console.log(`  ${t.score}  ${t.label} part ${t.idx + 1}`);
    const targetInTop5 = topGlobal.some((t) => t.label.toLowerCase().includes(fileNeedle));
    console.log(`Target in global top-5 chunks: ${targetInTop5}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
