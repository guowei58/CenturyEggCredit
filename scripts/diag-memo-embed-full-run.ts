import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { getLatestProjectForTicker } from "../src/lib/creditMemo/store";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { ensureKpiChunkEmbeddings, resolveCreditMemoEvidencePack } from "../src/lib/creditMemo/kpiRetrieval";
import { planMemoOutline } from "../src/lib/creditMemo/memoPlanner";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN" },
    select: { userId: true },
  });
  const user = await prisma.user.findUnique({ where: { id: row!.userId }, select: { email: true } });
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(
    buildLlmApiKeyBundle(user?.email, await getUserPreferences(row!.userId))
  );
  const project = await getLatestProjectForTicker(row!.userId, "GEN")!;

  const t0 = Date.now();
  const v = await ensureKpiChunkEmbeddings(row!.userId, project!, apiKeys);
  console.log(
    "ensureKpiChunkEmbeddings:",
    v.vectors
      ? `${v.chunksEmbedded ?? Object.keys(v.vectors).length} vectors in ${((Date.now() - t0) / 1000).toFixed(1)}s (cacheSaved=${v.cacheSaved})`
      : `FAILED — ${v.error ?? "null"}`
  );

  if (v.vectors) {
    const outline = planMemoOutline(10_000, project!.sources);
    const query = `GEN — Credit Memo\n${outline.sections.map((s) => s.title).join("\n")}`;
    const r = await resolveCreditMemoEvidencePack({
      userId: row!.userId,
      project: project!,
      apiKeys,
      query,
    });
    console.log("resolveCreditMemoEvidencePack:", {
      retrievalUsed: r.retrievalUsed,
      mode: r.diagnostics.mode,
      fallbackReason: r.diagnostics.fallbackReason ?? null,
      chunksInWindow: r.diagnostics.chunksInWindow ?? null,
      evidencePackChars: r.diagnostics.evidencePackChars,
      includedSources: r.diagnostics.sourceRows.filter((s) => s.packedChars > 0).length,
    });
  }

  await prisma.$disconnect();
}

main();
