/**
 * Find corpus conditions that produce exactly 140K for a7116 exhibit.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import {
  buildLmeChunksForDocument,
  embedRetrievalQueryForTask,
  lmeGlobalMaxChunksPerDocument,
  selectLmeChunksForBudget,
} from "../src/lib/lme-retrieval";
import { LME_DEFAULT_BUNDLE_CHAR_CAP, LME_DEFAULT_PER_PART_CHAR_CAP } from "../src/lib/lme-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { workspaceReadUtf8 } from "../src/lib/user-ticker-workspace-store";

const NEEDLE = "a7116exhibit403";

async function main() {
  const docRow = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE, mode: "insensitive" } },
    select: { userId: true },
  });
  const userId = docRow!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId))
  );

  const full = await collectWorkProductRawDocumentsWithAdditions("kpi", "GEN", userId, () =>
    collectKpiCommentaryRawDocuments("GEN", userId)
  );
  const exhibit = full.find((d) => d.label.toLowerCase().includes(NEEDLE))!;
  const defaultOnly = full.filter((d) => !d.label.startsWith("Added —"));
  const exhibitOnly = [exhibit];

  const cache = JSON.parse(
    (await workspaceReadUtf8(userId, "GEN", "credit-memo/lme-retrieval-embeddings/GEN.json"))!
  ) as { vectors: Record<string, number[]> };

  for (const [label, docs] of [
    ["exhibit_only", exhibitOnly],
    ["default_kpi_no_exhibit", defaultOnly],
    ["default_plus_exhibit", full],
  ] as const) {
    const bundled = await gatherKpiCommentarySources("GEN", undefined, userId, {
      useRetrieval: true,
      apiKeys,
    });
    // Hack: gather always uses full corpus — replay manually
    const allChunks = docs.flatMap((d) => buildLmeChunksForDocument(d.docId, d.label, d.raw));
    const q = (await embedRetrievalQueryForTask("kpi", apiKeys))!;
    const picked = selectLmeChunksForBudget(
      q,
      allChunks,
      cache.vectors,
      LME_DEFAULT_BUNDLE_CHAR_CAP,
      lmeGlobalMaxChunksPerDocument(),
      "kpi"
    );
    const exPicked = picked.filter((c) => c.docId === exhibit.docId);
    const chars = exPicked.reduce((s, c) => s + c.text.length, 0);
    console.log(
      `${label}: docs=${docs.length} exhibitChunks=${exPicked.length} exhibitChars=${chars} perPartCap=${LME_DEFAULT_PER_PART_CHAR_CAP}`
    );
  }

  // Sequential fallback: failed retrieval queue with only exhibit as large tier>=2 doc
  const seqBundled = await gatherKpiCommentarySources("GEN", undefined, userId, {
    useRetrieval: false,
    apiKeys,
  });
  const row = seqBundled.packingStats?.documentRows.find((r) => r.label.includes(NEEDLE));
  console.log(`sequential_full_corpus: exhibitInContext=${row?.packedChars ?? 0}`);

  await prisma.$disconnect();
}

main();
