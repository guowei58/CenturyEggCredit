import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle } from "../src/lib/user-llm-keys";

const NEEDLE = "a7116";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: NEEDLE } },
    select: { userId: true },
  });
  const userId = row!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const bundleOnly = buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId));

  const bundled = await gatherKpiCommentarySources("GEN", undefined, userId, {
    apiKeys: bundleOnly,
    useRetrieval: true,
  });
  const ex = bundled.packingStats?.documentRows.find((r) => r.label.includes(NEEDLE));
  console.log(
    JSON.stringify(
      {
        retrievalUsed: bundled.retrievalUsed,
        exhibitPacked: ex?.packedChars,
        exhibitAvailable: ex?.charsAvailable,
        totalPacked: bundled.packingStats?.packedPartsCharSum,
        hasOpenAiInBundle: Boolean(bundleOnly.openaiApiKey?.trim()),
        hasGeminiInBundle: Boolean(bundleOnly.geminiApiKey?.trim()),
        hasDeepSeekInBundle: Boolean(bundleOnly.deepseekApiKey?.trim()),
      },
      null,
      2
    )
  );
  await prisma.$disconnect();
}

main();
