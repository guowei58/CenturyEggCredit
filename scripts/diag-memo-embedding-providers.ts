/**
 * Test which embedding provider works for a user/ticker and why memo embed failed.
 * Usage: npx tsx scripts/diag-memo-embedding-providers.ts GEN
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { getLatestProjectForTicker } from "../src/lib/creditMemo/store";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import {
  embedTextsForKpiRetrieval,
  resolveKpiEmbeddingBackendMetadata,
} from "../src/lib/kpi-embedding-provider";
import { embedTextsOpenAI } from "../src/lib/openai-embeddings";

const ticker = (process.argv[2] ?? "GEN").trim().toUpperCase();

function maskKey(key: string | undefined | null): string {
  if (!key?.trim()) return "(none)";
  const k = key.trim();
  if (k.length <= 8) return "***";
  return `${k.slice(0, 4)}…${k.slice(-4)} (${k.length} chars)`;
}

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker },
    select: { userId: true },
  });
  if (!row?.userId) {
    console.error("No user for ticker", ticker);
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { email: true } });
  const prefs = await getUserPreferences(row.userId);
  const bundle = buildLlmApiKeyBundle(user?.email, prefs);
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(bundle);

  console.log("--- Embedding provider diagnose:", ticker, "---\n");
  console.log("Keys configured (masked):");
  console.log("  OpenAI:  ", maskKey(apiKeys.openaiApiKey));
  console.log("  Gemini:  ", maskKey(apiKeys.geminiApiKey));
  console.log("  DeepSeek:", maskKey(apiKeys.deepseekApiKey));
  console.log("  env OPENAI_API_KEY:", maskKey(process.env.OPENAI_API_KEY));
  console.log("  env GEMINI_API_KEY:", maskKey(process.env.GEMINI_API_KEY));
  console.log("  KPI_EMBEDDING_PROVIDER:", process.env.KPI_EMBEDDING_PROVIDER ?? "(default)");

  const hasGemini = Boolean(apiKeys.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim());
  const hasOpenAi = Boolean(apiKeys.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim());
  const order = hasOpenAi
    ? "openai → gemini → deepseek"
    : hasGemini
      ? "gemini → deepseek → openai"
      : "deepseek → gemini → openai";
  const backend = resolveKpiEmbeddingBackendMetadata(apiKeys);
  console.log("\nProvider try order:", order);
  console.log("Primary backend (cache metadata):", backend);

  const project = await getLatestProjectForTicker(row.userId, ticker);
  const chunkCount = project?.chunks.filter((c) => c.text.trim().length > 0).length ?? 0;
  console.log("\nMemo project chunks to embed:", chunkCount.toLocaleString());
  if (chunkCount > 5000) {
    console.log("  ⚠ Large corpus — first provider failure aborts entire memo retrieval.");
  }

  console.log("\n--- Single-text probe (memo query snippet) ---");
  const probe = "GEN credit memo capital structure covenant analysis";
  const unified = await embedTextsForKpiRetrieval([probe], apiKeys, { batchSize: 1, timeoutMs: 60_000 });
  console.log("embedTextsForKpiRetrieval (auto order):", unified.ok ? `OK via ${unified.provider}` : unified.error.slice(0, 400));

  if (apiKeys.openaiApiKey || process.env.OPENAI_API_KEY) {
    console.log("\n--- OpenAI-only probe (bypass Gemini preference) ---");
    const oai = await embedTextsOpenAI([probe], apiKeys, { batchSize: 1, timeoutMs: 60_000 });
    console.log("embedTextsOpenAI direct:", oai.ok ? "OK" : oai.error.slice(0, 400));
  }

  if (hasOpenAi && hasGemini) {
    console.log("\n--- Note ---");
    console.log("Both OpenAI and Gemini are configured → OpenAI is used first for embeddings.");
    console.log("Set KPI_EMBEDDING_PROVIDER=gemini to prefer Gemini instead.");
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
