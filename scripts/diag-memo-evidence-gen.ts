/**
 * Diagnose AI Memo evidence pack for a ticker (default GEN).
 * Usage: npx tsx scripts/diag-memo-evidence-gen.ts [TICKER]
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { getLatestProjectForTicker } from "../src/lib/creditMemo/store";
import { sortMemoDeckSourcesForEvidence } from "../src/lib/creditMemo/memoPlanner";
import { memoDeckEvidenceSourcePriority } from "../src/lib/creditMemo/workProductIngestScope";
import {
  isMemoRetrievalEnabled,
  memoFallbackMaxEvidenceChars,
  resolveCreditMemoEvidencePack,
} from "../src/lib/creditMemo/kpiRetrieval";
import { buildEvidencePackSync, computeMemoEvidenceSourceRows } from "../src/lib/creditMemo/evidencePack";
import { planMemoOutline } from "../src/lib/creditMemo/memoPlanner";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle, mergeLlmCallApiKeysWithProcessEnv } from "../src/lib/user-llm-keys";
import { hasAnyKpiEmbeddingKey } from "../src/lib/kpi-embedding-provider";

const ticker = (process.argv[2] ?? "GEN").trim().toUpperCase();

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker },
    select: { userId: true },
  });
  if (!row?.userId) {
    console.error("No saved documents / user for ticker", ticker);
    process.exit(1);
  }
  const userId = row.userId;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  const project = await getLatestProjectForTicker(userId, ticker);
  if (!project) {
    console.error("No credit memo project in store for", ticker, "user", userId);
    process.exit(1);
  }

  const prefs = await getUserPreferences(userId);
  const apiKeys = mergeLlmCallApiKeysWithProcessEnv(buildLlmApiKeyBundle(user?.email, prefs));

  const listed = project.sources.filter((s) => s.parseStatus !== "skipped");
  const ordered = sortMemoDeckSourcesForEvidence(project.sources).filter((s) => s.parseStatus !== "skipped");

  console.log("--- AI Memo evidence diagnose:", ticker, "---");
  console.log("projectId:", project.id);
  console.log("indexed files:", listed.length, "| ingest chunks:", project.chunks.length);
  console.log("MEMO_RETRIEVAL enabled:", isMemoRetrievalEnabled());
  console.log("has embedding key (OpenAI/Gemini/DeepSeek):", hasAnyKpiEmbeddingKey(apiKeys));
  console.log("sequential cap (MEMO_FALLBACK_MAX_EVIDENCE_CHARS):", memoFallbackMaxEvidenceChars());

  console.log("\n--- Pack priority order (first 20) ---");
  for (const s of ordered.slice(0, 20)) {
    console.log(
      `${memoDeckEvidenceSourcePriority(s.relPath).toString().padStart(3)}  ${s.charExtracted.toLocaleString().padStart(9)}  ${s.relPath}`
    );
  }
  if (ordered.length > 20) console.log(`... +${ordered.length - 20} more`);

  const outline = planMemoOutline(10_000, project.sources);
  const query = `${ticker} — Credit Memo\n${outline.sections.map((s) => s.title).join("\n")}\n${outline.sourceNotes}`.trim();

  const { evidence, retrievalUsed, diagnostics } = await resolveCreditMemoEvidencePack({
    userId,
    project,
    apiKeys,
    query,
  });

  console.log("\n--- resolveCreditMemoEvidencePack ---");
  console.log("retrievalUsed:", retrievalUsed);
  console.log("mode:", diagnostics.mode);
  console.log("fallbackReason:", diagnostics.fallbackReason ?? "(none)");
  console.log("evidenceCharCap:", diagnostics.evidenceCharCap.toLocaleString());
  console.log("evidencePackChars:", diagnostics.evidencePackChars.toLocaleString());
  console.log("chunksInWindow:", diagnostics.chunksInWindow ?? "n/a");

  const rows = diagnostics.sourceRows ?? computeMemoEvidenceSourceRows(project, evidence);
  const included = rows.filter((r) => r.packedChars > 0);
  const omitted = rows.filter((r) => r.packedChars === 0);
  console.log("\n--- In context (included):", included.length, "---");
  for (const r of included) {
    const delta = r.packedChars - r.charsAvailable;
    const partial = r.packedChars > 0 && r.packedChars < r.charsAvailable;
    console.log(
      `${r.packedChars.toLocaleString().padStart(9)} / ${r.charsAvailable.toLocaleString().padStart(9)}  ${partial ? "PARTIAL" : "full   "}  Δ${delta}  ${r.relPath}`
    );
  }
  console.log("\n--- Omitted (0 in context):", omitted.length, "(first 15) ---");
  for (const r of omitted.slice(0, 15)) {
    console.log(`        0 / ${r.charsAvailable.toLocaleString().padStart(9)}           ${r.relPath}`);
  }

  // Simulate sequential-only to show cap math
  const seq = buildEvidencePackSync(project, { maxChars: memoFallbackMaxEvidenceChars(), memoDeckOrder: true });
  let running = 0;
  console.log("\n--- Sequential fill simulation (cumulative chars) ---");
  for (const s of ordered) {
    const row = rows.find((r) => r.relPath === s.relPath);
    if (!row?.packedChars) continue;
    running += row.packedChars;
    console.log(`cum ${running.toLocaleString().padStart(9)}  +${row.packedChars.toLocaleString()}  ${s.relPath}`);
    if (running >= diagnostics.evidenceCharCap - 5000) break;
  }
  console.log("total evidence string length:", seq.length.toLocaleString());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
