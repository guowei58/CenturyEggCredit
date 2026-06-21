import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import {
  buildLmeChunksForDocument,
  embedRetrievalQueryForTask,
} from "../src/lib/lme-retrieval";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { workspaceReadUtf8 } from "../src/lib/user-ticker-workspace-store";

const NEEDLE = "a7116";

function dot(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!;
  return s;
}
function norm(v: number[]): number[] {
  let s = 0;
  for (const x of v) s += x * x;
  const n = Math.sqrt(s) || 1;
  return v.map((x) => x / n);
}

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE } },
    select: { userId: true },
  });
  const userId = row!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId))
  );
  const docs = await collectWorkProductRawDocumentsWithAdditions("kpi", "GEN", userId, () =>
    collectKpiCommentaryRawDocuments("GEN", userId)
  );
  const chunks = docs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
  const cache = JSON.parse(
    (await workspaceReadUtf8(userId, "GEN", "credit-memo/lme-retrieval-embeddings/GEN.json"))!
  ) as { vectors: Record<string, number[]> };
  const q = norm((await embedRetrievalQueryForTask("kpi", apiKeys))!);

  const scored = chunks
    .map((c) => {
      const v = cache.vectors[c.id];
      if (!v) return null;
      return { chunk: c, score: dot(q, norm(v)) };
    })
    .filter(Boolean) as { chunk: (typeof chunks)[0]; score: number }[];

  scored.sort((a, b) => b.score - a.score);

  console.log("Top 15 chunks overall:");
  for (const { chunk, score } of scored.slice(0, 15)) {
    const mark = chunk.label.includes(NEEDLE) ? " <-- EXHIBIT" : "";
    console.log(`  ${score.toFixed(4)}  ${chunk.label.slice(0, 70)} [${chunk.chunkIndex}]${mark}`);
  }

  const ex = scored.filter((s) => s.chunk.label.includes(NEEDLE));
  console.log(`\nExhibit: ${ex.length} chunks, best=${ex[0]?.score.toFixed(4)}, rank among all chunks=${scored.findIndex((s) => s.chunk.label.includes(NEEDLE)) + 1}/${scored.length}`);

  await prisma.$disconnect();
}

main();
