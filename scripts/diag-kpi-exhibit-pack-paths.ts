/**
 * Compare KPI pack paths: retrieval ON vs OFF vs no embedding keys.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { prisma } from "../src/lib/prisma";
import { gatherKpiCommentarySources } from "../src/lib/kpi-workspace-sources";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";

const NEEDLE = "a7116exhibit403";

function exhibitRow(
  documentRows: { label: string; file?: string; packedChars: number; charsAvailable: number }[] | undefined
) {
  return documentRows?.find(
    (r) => r.label.toLowerCase().includes(NEEDLE) || r.file?.toLowerCase().includes(NEEDLE)
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
  const emptyKeys = {};

  for (const [label, opts] of [
    ["retrieval_ON", { useRetrieval: true, apiKeys: fullKeys }],
    ["retrieval_OFF", { useRetrieval: false, apiKeys: fullKeys }],
    ["retrieval_ON_no_keys", { useRetrieval: true, apiKeys: emptyKeys }],
  ] as const) {
    const bundled = await gatherKpiCommentarySources("GEN", undefined, userId, opts);
    const row = exhibitRow(bundled.packingStats?.documentRows);
    console.log(
      `${label}: retrievalUsed=${bundled.retrievalUsed} exhibitInContext=${row?.packedChars ?? 0} available=${row?.charsAvailable ?? 0} totalPacked=${bundled.packingStats?.packedPartsCharSum ?? 0}`
    );
  }

  await prisma.$disconnect();
}

main();
