/**
 * Diagnose KPI commentary retrieval pack for a saved document (default: a7116exhibit403.html).
 * Usage: npx tsx scripts/diag-kpi-retrieval-exhibit.ts [TICKER] [FILENAME_SUBSTRING]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import {
  buildLmeChunksForDocument,
  embedRetrievalQueryForTask,
  ensureLmeRetrievalEmbeddings,
  lmeChunkSizeChars,
  lmeGlobalMaxChunksPerDocument,
  lmeGlobalRankMaxChunks,
  selectLmeChunksForBudget,
  retrievalQueryForTask,
  type LmeIndexedChunk,
} from "../src/lib/lme-retrieval";
import { LME_DEFAULT_BUNDLE_CHAR_CAP } from "../src/lib/lme-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { hasAnyKpiEmbeddingKey } from "../src/lib/kpi-embedding-provider";

const tickerArg = (process.argv[2] ?? "").trim().toUpperCase();
const fileNeedle = (process.argv[3] ?? "a7116exhibit403").trim().toLowerCase();

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

function scoreChunks(
  queryVec: number[],
  chunks: LmeIndexedChunk[],
  vectors: Record<string, number[]>
): Map<string, { best: number; meanTop5: number; count: number }> {
  const q = l2normalize(queryVec);
  const byDoc = new Map<string, number[]>();
  for (const c of chunks) {
    const v = vectors[c.id];
    if (!v?.length) continue;
    const score = dot(q, l2normalize(v));
    if (!byDoc.has(c.docId)) byDoc.set(c.docId, []);
    byDoc.get(c.docId)!.push(score);
  }
  const out = new Map<string, { best: number; meanTop5: number; count: number }>();
  for (const [docId, scores] of byDoc) {
    scores.sort((a, b) => b - a);
    const top5 = scores.slice(0, 5);
    out.set(docId, {
      best: scores[0] ?? 0,
      meanTop5: top5.reduce((s, x) => s + x, 0) / (top5.length || 1),
      count: scores.length,
    });
  }
  return out;
}

function chunkTextChars(picked: LmeIndexedChunk[]): number {
  return picked.reduce((s, c) => s + c.text.length, 0);
}

async function main() {
  const docRows = await prisma.userSavedDocument.findMany({
    where: {
      ...(tickerArg ? { ticker: tickerArg } : {}),
      filename: { contains: fileNeedle, mode: "insensitive" },
    },
    select: { userId: true, ticker: true, filename: true, bytes: true },
    take: 5,
  });

  if (!docRows.length) {
    console.error(`No saved document matching "${fileNeedle}"${tickerArg ? ` for ${tickerArg}` : ""}.`);
    process.exit(1);
  }

  console.log("Matched saved documents:");
  for (const r of docRows) {
    console.log(`  ${r.ticker} user=${r.userId.slice(0, 8)}… ${r.filename} (${r.bytes} bytes)`);
  }

  const { userId, ticker } = docRows[0]!;
  console.log(`\n=== KPI pack diagnostic: ${ticker} ===\n`);

  const prefs = await getUserPreferences(userId);
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(buildLlmApiKeyBundle(user?.email, prefs));
  console.log("Embedding keys configured:", hasAnyKpiEmbeddingKey(apiKeys));

  const rawDocs = await collectWorkProductRawDocumentsWithAdditions("kpi", ticker, userId, () =>
    collectKpiCommentaryRawDocuments(ticker, userId)
  );

  const target = rawDocs.find(
    (d) => d.file?.toLowerCase().includes(fileNeedle) || d.label.toLowerCase().includes(fileNeedle)
  );
  console.log(`\nRaw corpus: ${rawDocs.length} documents, ${rawDocs.reduce((s, d) => s + d.raw.length, 0).toLocaleString()} chars`);
  if (target) {
    console.log(
      `Target doc: docId=${target.docId} label=${target.label} rawChars=${target.raw.length.toLocaleString()} tier=${target.tier}`
    );
  } else {
    console.log(`Target "${fileNeedle}" NOT in KPI raw corpus (not applied via extra ingest?).`);
  }

  const bundled = await gatherKpiCommentarySources(ticker, undefined, userId, {
    apiKeys,
    useRetrieval: true,
  });

  console.log("\n--- gatherKpiCommentarySources (useRetrieval: true) ---");
  console.log("retrievalUsed:", bundled.retrievalUsed);
  console.log("parts:", bundled.parts.length, "part chars:", bundled.parts.reduce((s, p) => s + p.content.length, 0));
  const ps = bundled.packingStats;
  if (ps) {
    console.log("bundleCharCap:", ps.bundleCharCap);
    console.log("packedPartsCharSum:", ps.packedPartsCharSum);
    console.log("retrievalUsed (stats):", ps.retrievalUsed);
    if (ps.retrievalPack) {
      const rp = ps.retrievalPack;
      console.log("retrievalPack.mode:", rp.mode, "task:", rp.task);
      console.log("chunksBuilt:", rp.chunksBuilt, "chunksEmbedded:", rp.chunksEmbedded);
      console.log("chunksInWindow:", rp.chunksInWindow);
      console.log("maxPerDoc (env):", lmeGlobalMaxChunksPerDocument());
      console.log("chunkSize (env):", lmeChunkSizeChars());
      console.log("\nTop documents in retrieval window (by chunk count):");
      for (const row of rp.documentsInWindow.slice(0, 12)) {
        console.log(`  ${row.chunksFromDocInWindow} chunks  ${row.label}`);
      }
    }
    console.log("\nPer-document packed chars (documentRows):");
    const sorted = [...ps.documentRows].sort((a, b) => b.packedChars - a.packedChars);
    for (const row of sorted) {
      const mark =
        row.label.toLowerCase().includes(fileNeedle) || row.file?.toLowerCase().includes(fileNeedle) ? " <-- TARGET" : "";
      console.log(
        `  ${row.packedChars.toLocaleString().padStart(9)} / ${row.charsAvailable.toLocaleString().padStart(9)}  ${row.label}${mark}`
      );
    }
  }

  if (!hasAnyKpiEmbeddingKey(apiKeys)) {
    console.log("\nNo embedding API key — retrieval fell back or failed; skipping score breakdown.");
    await prisma.$disconnect();
    return;
  }

  const allChunks = rawDocs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
  const capped = allChunks.slice(0, lmeGlobalRankMaxChunks());
  console.log(`\n--- Embedding score breakdown (${capped.length} chunks embedded cap) ---`);
  console.log("KPI query lines:");
  for (const line of retrievalQueryForTask("kpi").split("\n")) console.log(`  ${line}`);

  const vectors = await ensureLmeRetrievalEmbeddings(userId, ticker, capped, apiKeys);
  const qVec = await embedRetrievalQueryForTask("kpi", apiKeys);
  if (!vectors || !qVec) {
    console.error("Embedding failed.");
    await prisma.$disconnect();
    process.exit(1);
  }

  const docScores = scoreChunks(qVec, capped, vectors);
  const rankedDocs = [...docScores.entries()]
    .map(([docId, s]) => {
      const meta = rawDocs.find((d) => d.docId === docId);
      return { docId, label: meta?.label ?? docId, file: meta?.file, ...s };
    })
    .sort((a, b) => b.best - a.best);

  console.log("\nDocuments ranked by best chunk cosine score:");
  for (const row of rankedDocs.slice(0, 15)) {
    const mark =
      row.label.toLowerCase().includes(fileNeedle) || row.file?.toLowerCase().includes(fileNeedle) ? " <-- TARGET" : "";
    console.log(
      `  best=${row.best.toFixed(4)} meanTop5=${row.meanTop5.toFixed(4)} chunks=${row.count}  ${row.label}${mark}`
    );
  }

  const maxPerDoc = lmeGlobalMaxChunksPerDocument();
  const budget = LME_DEFAULT_BUNDLE_CHAR_CAP;
  const picked = selectLmeChunksForBudget(qVec, capped, vectors, budget, maxPerDoc, "kpi");

  const pickedByDoc = new Map<string, LmeIndexedChunk[]>();
  for (const c of picked) {
    if (!pickedByDoc.has(c.docId)) pickedByDoc.set(c.docId, []);
    pickedByDoc.get(c.docId)!.push(c);
  }

  console.log(`\n--- selectLmeChunksForBudget replay (budget=${budget}, maxPerDoc=${maxPerDoc}) ---`);
  console.log("Total picked chunks:", picked.length, "chunk-text chars:", chunkTextChars(picked).toLocaleString());
  const pickedRanked = [...pickedByDoc.entries()]
    .map(([docId, chunks]) => {
      const meta = rawDocs.find((d) => d.docId === docId);
      const scores = docScores.get(docId);
      return {
        docId,
        label: meta?.label ?? docId,
        file: meta?.file,
        chunks: chunks.length,
        textChars: chunkTextChars(chunks),
        bestScore: scores?.best ?? 0,
      };
    })
    .sort((a, b) => b.textChars - a.textChars);

  for (const row of pickedRanked) {
    const mark =
      row.label.toLowerCase().includes(fileNeedle) || row.file?.toLowerCase().includes(fileNeedle) ? " <-- TARGET" : "";
    console.log(
      `  ${row.chunks} chunks  ${row.textChars.toLocaleString()} text chars  bestScore=${row.bestScore.toFixed(4)}  ${row.label}${mark}`
    );
  }

  if (target) {
    const tChunks = pickedByDoc.get(target.docId) ?? [];
    console.log(`\nTarget summary:`);
    console.log(`  Chunks in corpus: ${docScores.get(target.docId)?.count ?? 0}`);
    console.log(`  Chunks picked: ${tChunks.length} (maxPerDoc=${maxPerDoc})`);
    console.log(`  Packed text chars (UI "In context"): ${chunkTextChars(tChunks).toLocaleString()}`);
    console.log(`  Best chunk score: ${(docScores.get(target.docId)?.best ?? 0).toFixed(4)}`);
    const rank = rankedDocs.findIndex((r) => r.docId === target.docId) + 1;
    console.log(`  Doc rank by best-chunk score: ${rank} / ${rankedDocs.length}`);
    if (tChunks.length >= maxPerDoc) {
      console.log(`  => Hit LME_GLOBAL_MAX_CHUNKS_PER_DOC cap (${maxPerDoc})`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
