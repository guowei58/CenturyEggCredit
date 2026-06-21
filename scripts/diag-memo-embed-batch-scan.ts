/**
 * Find which OpenAI embedding batch fails for GEN memo corpus.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { getLatestProjectForTicker } from "../src/lib/creditMemo/store";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { embedTextsOpenAI } from "../src/lib/openai-embeddings";

const batchSize = 64;

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN" },
    select: { userId: true },
  });
  const user = await prisma.user.findUnique({ where: { id: row!.userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(row!.userId))
  );
  const project = await getLatestProjectForTicker(row!.userId, "GEN");
  const chunks = project!.chunks.filter((c) => c.text.trim());
  const batches = Math.ceil(chunks.length / batchSize);
  console.log(`Embedding ${chunks.length} chunks in ${batches} batches sequentially…`);

  const t0 = Date.now();
  for (let bi = 0; bi < batches; bi++) {
    const texts = chunks.slice(bi * batchSize, (bi + 1) * batchSize).map((c) => c.text.slice(0, 30_000));
    const r = await embedTextsOpenAI(texts, apiKeys, { batchSize, timeoutMs: 120_000 });
    if (!r.ok) {
      console.log(`\nFAILED at batch ${bi + 1}/${batches} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      console.log(r.error);
      process.exit(1);
    }
    if ((bi + 1) % 25 === 0 || bi === batches - 1) {
      console.log(`batch ${bi + 1}/${batches} OK — elapsed ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
  }
  console.log(`\nAll ${batches} batches OK in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await prisma.$disconnect();
}

main();
