/**
 * Check whether each document's chunks are included in the global embed cap.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import {
  buildLmeChunksForDocument,
  lmeGlobalRankMaxChunks,
} from "../src/lib/lme-retrieval";

const NEEDLE = "a7116";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE } },
    select: { userId: true },
  });
  const userId = row!.userId;
  const docs = await collectWorkProductRawDocumentsWithAdditions("kpi", "GEN", userId, () =>
    collectKpiCommentaryRawDocuments("GEN", userId)
  );
  const allChunks = docs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
  const maxChunks = lmeGlobalRankMaxChunks();
  const capped = allChunks.slice(0, maxChunks);

  const chunkCountByDoc = new Map<string, number>();
  const cappedCountByDoc = new Map<string, number>();
  for (const c of allChunks) chunkCountByDoc.set(c.docId, (chunkCountByDoc.get(c.docId) ?? 0) + 1);
  for (const c of capped) cappedCountByDoc.set(c.docId, (cappedCountByDoc.get(c.docId) ?? 0) + 1);

  console.log(`Total chunks: ${allChunks.length}, cap: ${maxChunks}, capped: ${capped.length}`);
  for (const d of docs) {
    const total = chunkCountByDoc.get(d.docId) ?? 0;
    const inCap = cappedCountByDoc.get(d.docId) ?? 0;
    const mark = d.label.includes(NEEDLE) ? " <-- TARGET" : "";
    if (inCap === 0 && total > 0) {
      console.log(`  EXCLUDED FROM EMBED: ${d.label.slice(0, 70)} chunks=${total}${mark}`);
    } else if (inCap < total) {
      console.log(`  PARTIAL IN CAP: ${d.label.slice(0, 70)} ${inCap}/${total}${mark}`);
    }
  }

  const ex = docs.find((d) => d.label.includes(NEEDLE));
  if (ex) {
    console.log(`\nTarget: totalChunks=${chunkCountByDoc.get(ex.docId)} inCap=${cappedCountByDoc.get(ex.docId) ?? 0}`);
  }
  await prisma.$disconnect();
}

main();
