/**
 * Audit memo embedding failure: cache state, batch timing, full resolve outcome.
 * Usage: npx tsx scripts/diag-memo-embed-audit.ts GEN
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
import { workspaceReadUtf8 } from "../src/lib/user-ticker-workspace-store";
import { WORKSPACE_GLOBAL_TICKER } from "../src/lib/user-ticker-workspace-constants";
import {
  ensureKpiChunkEmbeddings,
  resolveCreditMemoEvidencePack,
  isMemoRetrievalEnabled,
} from "../src/lib/creditMemo/kpiRetrieval";
import { planMemoOutline } from "../src/lib/creditMemo/memoPlanner";
import { readSavedContent } from "../src/lib/saved-content-hybrid";
import { MEMO_DECK_BUILT_PROMPT_CACHE_KEY } from "../src/lib/creditMemo/builtPromptCache";

const ticker = (process.argv[2] ?? "GEN").trim().toUpperCase();
const quick = process.argv.includes("--quick");
const EMBED_STORAGE_PREFIX = "credit-memo/kpi-embeddings";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker },
    select: { userId: true },
  });
  if (!row?.userId) {
    console.error("No user for ticker", ticker);
    process.exit(1);
  }
  const userId = row.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const prefs = await getUserPreferences(userId);
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(buildLlmApiKeyBundle(user?.email, prefs));
  const project = await getLatestProjectForTicker(userId, ticker);
  if (!project) {
    console.error("No project");
    process.exit(1);
  }

  const chunks = project.chunks.filter((c) => c.text.trim().length > 0);
  const batchSize = 64;
  const batches = Math.ceil(chunks.length / batchSize);

  console.log("=== GEN Memo embedding audit ===\n");
  console.log("projectId:", project.id);
  console.log("project.updatedAt:", project.updatedAt);
  console.log("indexed sources:", project.sources.filter((s) => s.parseStatus !== "skipped").length);
  console.log("non-empty chunks:", chunks.length.toLocaleString());
  console.log("OpenAI batches needed (@64):", batches);
  console.log("MEMO_RETRIEVAL:", isMemoRetrievalEnabled());
  console.log("embedding backend:", resolveKpiEmbeddingBackendMetadata(apiKeys));
  console.log("memo-prompt API maxDuration: 300s (5 min) — full embed may exceed this\n");

  const safeId = project.id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const cachePath = `${EMBED_STORAGE_PREFIX}/${safeId}.json`;
  const cacheRaw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, cachePath);
  if (cacheRaw?.trim()) {
    try {
      const cache = JSON.parse(cacheRaw) as {
        embeddingProvider?: string;
        embeddingModel?: string;
        projectUpdatedAt?: string;
        vectors?: Record<string, number[]>;
      };
      const vecCount = Object.keys(cache.vectors ?? {}).length;
      console.log("--- Stored embedding cache ---");
      console.log("path:", cachePath);
      console.log("provider:", cache.embeddingProvider ?? "openai (legacy)");
      console.log("model:", cache.embeddingModel);
      console.log("cached projectUpdatedAt:", cache.projectUpdatedAt);
      console.log("project.updatedAt matches cache:", cache.projectUpdatedAt === project.updatedAt);
      console.log("vectors in cache:", vecCount.toLocaleString(), "/ chunks:", chunks.length.toLocaleString());
      console.log("cache complete:", vecCount >= chunks.length && cache.projectUpdatedAt === project.updatedAt);
    } catch {
      console.log("Stored cache: present but invalid JSON");
    }
  } else {
    console.log("--- Stored embedding cache: NONE ---");
  }

  const savedCache = await readSavedContent(ticker, MEMO_DECK_BUILT_PROMPT_CACHE_KEY, userId);
  if (savedCache?.trim()) {
    try {
      const parsed = JSON.parse(savedCache) as {
        sharedContext?: { evidenceDiagnostics?: { mode?: string; fallbackReason?: string; retrievalUsed?: boolean } };
      };
      const d = parsed.sharedContext?.evidenceDiagnostics;
      if (d) {
        console.log("\n--- Last saved build (sharedContext diagnostics) ---");
        console.log("mode:", d.mode);
        console.log("fallbackReason:", (d as { fallbackReason?: string }).fallbackReason ?? "(none)");
      }
    } catch {
      /* ignore */
    }
  }

  console.log("--- Batch timing probes (OpenAI) ---");
  for (const batchIdx of quick ? [0, 10, 50, 150, 250, batches - 1] : [0, 1, 50, 100, 200]) {
    if (batchIdx >= batches) continue;
    const start = batchIdx * batchSize;
    const texts = chunks.slice(start, start + batchSize).map((c) => c.text.slice(0, 30_000));
    const t0 = Date.now();
    const r = await embedTextsOpenAI(texts, apiKeys, { batchSize, timeoutMs: 120_000 });
    const ms = Date.now() - t0;
    console.log(
      `batch ${batchIdx + 1}/${batches} (chunks ${start}-${start + texts.length - 1}):`,
      r.ok ? `OK ${ms}ms` : `FAIL ${ms}ms — ${r.error.slice(0, 200)}`
    );
    if (!r.ok) break;
  }

  const estMsPerBatch = 800;
  console.log(
    `\nEstimated full embed time (@${estMsPerBatch}ms/batch): ~${Math.round((batches * estMsPerBatch) / 1000 / 60)} min (route limit 5 min)\n`
  );

  if (quick) {
    console.log("\n(--quick: skipping full ensureKpiChunkEmbeddings)");
    await prisma.$disconnect();
    return;
  }

  console.log("--- ensureKpiChunkEmbeddings (full run, may take several minutes) ---");
  const tFull = Date.now();
  const vectors = await ensureKpiChunkEmbeddings(userId, project, apiKeys);
  const fullMs = Date.now() - tFull;
  console.log(
    "ensureKpiChunkEmbeddings:",
    vectors.vectors
      ? `OK — ${vectors.chunksEmbedded ?? Object.keys(vectors.vectors).length} vectors in ${(fullMs / 1000).toFixed(1)}s (cacheSaved=${vectors.cacheSaved})`
      : `FAILED — ${vectors.error ?? "returned null"}`
  );

  if (!vectors.vectors) {
    console.log("\nSkipping resolveCreditMemoEvidencePack — chunk embed failed.");
    await prisma.$disconnect();
    return;
  }

  const outline = planMemoOutline(10_000, project.sources);
  const query = `${ticker} — Credit Memo\n${outline.sections.map((s) => s.title).join("\n")}`.trim();
  const { retrievalUsed, diagnostics } = await resolveCreditMemoEvidencePack({
    userId,
    project,
    apiKeys,
    query,
  });
  console.log("\n--- resolveCreditMemoEvidencePack ---");
  console.log("retrievalUsed:", retrievalUsed);
  console.log("mode:", diagnostics.mode);
  console.log("fallbackReason:", diagnostics.fallbackReason ?? "(none)");
  console.log("chunksInWindow:", diagnostics.chunksInWindow ?? "n/a");
  console.log("evidencePackChars:", diagnostics.evidencePackChars.toLocaleString());

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
