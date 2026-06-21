import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: "a7116" } },
    select: { userId: true },
  });
  const userId = row!.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(userId))
  );

  const b = await gatherKpiCommentarySources("GEN", undefined, userId, { useRetrieval: true, apiKeys });
  console.log("retrievalUsed:", b.retrievalUsed);
  console.log("retrievalPack:", b.packingStats?.retrievalPack);
  const rows = b.packingStats?.documentRows ?? [];
  const zero = rows.filter((r) => r.packedChars === 0);
  const ex = rows.find((r) => r.label.includes("a7116"));
  console.log("\nExhibit:", ex);
  if (zero.length) {
    console.log("\nDocs with 0 in context:");
    for (const r of zero) console.log(" ", r.label.slice(0, 80));
  }
  await prisma.$disconnect();
}

main();
