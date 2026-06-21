/**
 * Simulate small corpus + sequential pack to reproduce exact 140000.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { collectWorkProductRawDocumentsWithAdditions } from "../src/lib/work-product-ingest-additions";
import { collectKpiCommentaryRawDocuments } from "../src/lib/kpi-workspace-sources";
import { packLmeSourcesForModel } from "../src/lib/lme-sources";
import { LME_DEFAULT_PER_PART_CHAR_CAP } from "../src/lib/lme-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";

const NEEDLE = "a7116exhibit403";

async function pack(
  label: string,
  userId: string,
  docs: Parameters<typeof packLmeSourcesForModel>[2],
  apiKeys: object,
  useRetrieval: boolean
) {
  const { retrievalUsed, documentRows } = await packLmeSourcesForModel("GEN", userId, docs, undefined, {
    useRetrieval,
    apiKeys: apiKeys as never,
    globalChunkPackTask: useRetrieval ? "kpi" : undefined,
  });
  const row = documentRows.find((r) => r.label.toLowerCase().includes(NEEDLE));
  const total = documentRows.reduce((s, r) => s + r.packedChars, 0);
  console.log(
    `${label}: retrievalUsed=${retrievalUsed} exhibit=${row?.packedChars ?? 0} total=${total} perPartCap=${LME_DEFAULT_PER_PART_CHAR_CAP}`
  );
}

async function main() {
  const docRow = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE, mode: "insensitive" } },
    select: { userId: true },
  });
  const userId = docRow!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const fullKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId))
  );

  const full = await collectWorkProductRawDocumentsWithAdditions("kpi", "GEN", userId, () =>
    collectKpiCommentaryRawDocuments("GEN", userId)
  );
  const exhibit = full.find((d) => d.label.toLowerCase().includes(NEEDLE))!;
  const readthrus = full.filter((d) => d.label.toLowerCase().includes("competitor") || d.key?.includes("competitor"));
  const small = [...readthrus, exhibit];

  console.log(`readthrus=${readthrus.length} chars=${readthrus.reduce((s, d) => s + d.raw.length, 0)}`);

  await pack("small_corpus_no_retrieval", userId, small, fullKeys, false);
  await pack("small_corpus_no_keys", userId, small, {}, false);
  await pack("small_corpus_retrieval_on", userId, small, fullKeys, true);
  await pack("full_corpus_no_retrieval", userId, full, fullKeys, false);
  await pack("full_corpus_retrieval_on", userId, full, fullKeys, true);

  await prisma.$disconnect();
}

main();
