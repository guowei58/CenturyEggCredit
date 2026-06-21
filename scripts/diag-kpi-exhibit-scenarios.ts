import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import {
  buildLmeChunksForDocument,
  embedRetrievalQueryForTask,
  lmeGlobalMaxChunksPerDocument,
  lmeGlobalRankMaxChunks,
  selectLmeChunksForBudget,
} from "../src/lib/lme-retrieval";
import { LME_DEFAULT_BUNDLE_CHAR_CAP, LME_DEFAULT_PER_PART_CHAR_CAP } from "../src/lib/lme-sources";
import { workspaceReadUtf8 } from "../src/lib/user-ticker-workspace-store";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import type { LmeRawDocument } from "../src/lib/lme-sources";

async function runScenario(label: string, rawDocs: LmeRawDocument[], vectors: Record<string, number[]>, q: number[]) {
  const allChunks = rawDocs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
  const capped = allChunks.slice(0, lmeGlobalRankMaxChunks());
  const picked = selectLmeChunksForBudget(
    q,
    capped,
    vectors,
    LME_DEFAULT_BUNDLE_CHAR_CAP,
    lmeGlobalMaxChunksPerDocument(),
    "kpi"
  );
  const target = rawDocs.find((d) => d.label.includes("a7116"));
  const tPicked = picked.filter((c) => c.docId === target?.docId);
  const chars = tPicked.reduce((s, c) => s + c.text.length, 0);
  console.log(
    `${label}: docs=${rawDocs.length} exhibitChunks=${tPicked.length} exhibitChars=${chars} (perPartCap=${LME_DEFAULT_PER_PART_CHAR_CAP} maxPerDoc=${lmeGlobalMaxChunksPerDocument()})`
  );
}

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: "a7116" } },
    select: { userId: true },
  });
  const userId = row!.userId;
  const full = await collectWorkProductRawDocumentsWithAdditions("kpi", "GEN", userId, () =>
    collectKpiCommentaryRawDocuments("GEN", userId)
  );
  const noMgmt = full.filter((d) => !d.label.toLowerCase().includes("mgmt-presentation"));
  const transcriptsOnly = full.filter(
    (d) => d.label.includes("earnings-transcript") || d.label.includes("competitor") || d.label.includes("a7116")
  );

  const cache = JSON.parse(
    (await workspaceReadUtf8(userId, "GEN", "credit-memo/lme-retrieval-embeddings/GEN.json"))!
  ) as { vectors: Record<string, number[]> };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId))
  );
  const q = (await embedRetrievalQueryForTask("kpi", apiKeys))!;

  await runScenario("FULL_CORPUS", full, cache.vectors, q);
  await runScenario("NO_MGMT_PRESENTATIONS", noMgmt, cache.vectors, q);
  await runScenario("TRANSCRIPTS_PLUS_EXHIBIT_ONLY", transcriptsOnly, cache.vectors, q);

  await prisma.$disconnect();
}

main();
