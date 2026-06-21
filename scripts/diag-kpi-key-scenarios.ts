import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle } from "../src/lib/user-llm-keys";

const NEEDLE = "a7116";

async function run(label: string, apiKeys: object) {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE } },
    select: { userId: true },
  });
  const b = await gatherKpiCommentarySources("GEN", undefined, row!.userId, {
    apiKeys: apiKeys as never,
    useRetrieval: true,
  });
  const ex = b.packingStats?.documentRows.find((r) => r.label.includes(NEEDLE));
  console.log(`${label}: retrievalUsed=${b.retrievalUsed} exhibit=${ex?.packedChars ?? 0}`);
}

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE } },
    select: { userId: true },
  });
  const user = await prisma.user.findUnique({ where: { id: row!.userId }, select: { email: true } });
  const prefs = await getUserPreferences(row!.userId);
  const full = buildLlmApiKeyBundle(user?.email, prefs);
  const deepseekOnly = { deepseekApiKey: full.deepseekApiKey };

  await run("empty_keys", {});
  await run("deepseek_only", deepseekOnly);
  await run("openai_only", { openaiApiKey: full.openaiApiKey });
  await prisma.$disconnect();
}

main();
