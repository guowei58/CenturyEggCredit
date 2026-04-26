import { FORENSIC_ACCOUNTING_SYSTEM_PROMPT, FORENSIC_ACCOUNTING_TASK_PROMPT, FORENSIC_RETRIEVAL_QUERY } from "@/data/forensic-accounting-prompt";
import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";
import { retrievalQueryForTask } from "@/lib/lme-retrieval";
import { gatherForensicWorkspaceSources } from "@/lib/forensic-workspace-sources";
import type { LmeRawDocument, LmeRunPackingStats, LmeSourcePart } from "@/lib/lme-sources";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { loadCreditMemoConfig } from "./config";

type ForensicResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

function formatSourcesForForensicAnalysis(ticker: string, parts: LmeSourcePart[]): string {
  const sym = ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  const header =
    `Ticker: ${sym}\n` +
    `The blocks below are packed from your ticker workspace, saved tabs, and Saved Documents, excluding sources that already feed **LME Analysis** (same paths and tab keys as the LME tab, plus Saved Documents that pass the LME include gate). ` +
    `Excel spreadsheets, generated work products, and embedding caches are also excluded. ` +
    `When retrieval is enabled, you receive embedding-ranked context under the same 520k default bundle ceiling as LME/KPI. ` +
    `Use them as the primary factual basis for forensic claims.\n\n`;
  const blocks = parts.map(
    (p) =>
      `==========\nSOURCE: ${p.label}${p.key ? ` [key:${p.key}]` : ""}${p.file ? ` [file:${p.file}]` : ""}\n==========\n${p.content}\n`
  );
  return header + blocks.join("\n");
}

function formatForensicRawDocsInventory(rawDocs: LmeRawDocument[]): string {
  return rawDocs
    .filter((d) => d.raw.trim().length > 0)
    .map((d) => `- ${d.label}${d.file ? ` — ${d.file}` : ""} (${d.raw.length.toLocaleString()} chars)`)
    .join("\n");
}

/** @deprecated Use `FORENSIC_RETRIEVAL_QUERY` from `@/data/forensic-accounting-prompt` (same string). */
export const FORENSIC_EVIDENCE_QUERY = FORENSIC_RETRIEVAL_QUERY;

export type ForensicAccountingRunDiagnostics = {
  /** Count of raw documents (workspace files + saved tabs + saved documents) after Excel / work-product exclusions. */
  rawSourceDocuments: number;
  inventoryChars: number;
  evidencePackChars: number;
  /** Same bundle ceiling as LME (`LME_DEFAULT_BUNDLE_CHAR_CAP`). */
  evidenceContextBudgetChars: number;
  taskPromptChars: number;
  userMessageChars: number;
  systemMessageChars: number;
  evidenceQueryLines: string[];
  retrievalUsed: boolean;
  packingStats: LmeRunPackingStats;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
};

function buildUserPrompt(params: { ticker: string; companyName?: string; inventory: string; evidence: string }): string {
  const { ticker, companyName, inventory, evidence } = params;
  const co = companyName?.trim() ? `Company: ${companyName.trim()}\n` : "";
  return `
# TICKER
${ticker}
${co}
# TASK
${FORENSIC_ACCOUNTING_TASK_PROMPT}

# FILE INVENTORY
${inventory}

# EVIDENCE (SOURCE PACK)
${evidence}

---
Produce the full output in Markdown now, following the task format exactly. Cite sources inline for all material facts and figures as specified in your system rules.
`.trim();
}

export async function runForensicAccountingAnalysisGeneration(params: {
  ticker: string;
  provider: AiProvider;
  companyName?: string;
  models: ForensicResolvedModels;
  apiKeys: LlmCallApiKeys;
  userId: string | null;
}): Promise<
  | {
      ok: true;
      markdown: string;
      sourcePack: string;
      sentSystemMessage: string;
      sentUserMessage: string;
      diagnostics: ForensicAccountingRunDiagnostics;
      sourceFingerprint: string;
    }
  | { ok: false; error: string }
> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const sym = params.ticker.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym) {
    return { ok: false, error: "Invalid ticker" };
  }

  const bundled = await gatherForensicWorkspaceSources(sym, undefined, params.userId, {
    apiKeys: params.apiKeys,
    useRetrieval: true,
  });

  if (bundled.rawDocuments.length === 0) {
    return {
      ok: false,
      error:
        "No ingestible workspace sources found for this ticker. Upload files to your ticker workspace and/or save tab content (excluding generated outputs), then try again.",
    };
  }

  const hasSubstantive = bundled.parts.some(
    (p) => p.content.trim().length > 40 && !p.content.startsWith("[Binary")
  );
  if (!hasSubstantive) {
    return {
      ok: false,
      error:
        "No substantive text found. Add non-Excel files or saved tab text to your ticker workspace (generated tab outputs are excluded), then try again.",
    };
  }

  const packingStats = bundled.packingStats;
  if (!packingStats) {
    return { ok: false, error: "Internal error: missing packing stats for forensic run." };
  }

  const inventory = formatForensicRawDocsInventory(bundled.rawDocuments);
  const evidenceFormatted = formatSourcesForForensicAnalysis(sym, bundled.parts);
  const user = buildUserPrompt({
    ticker: sym,
    companyName: params.companyName,
    inventory,
    evidence: evidenceFormatted,
  });

  const userMessageBreakdown: LmeUserMessageCharBreakdown = {
    taskSpecChars: FORENSIC_ACCOUNTING_TASK_PROMPT.length,
    bridgeChars: user.length - evidenceFormatted.length - FORENSIC_ACCOUNTING_TASK_PROMPT.length,
    formattedSourcesChars: evidenceFormatted.length,
    totalUserMessageChars: user.length,
  };

  const evidenceQueryLines = retrievalQueryForTask("forensic")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const diagnostics: ForensicAccountingRunDiagnostics = {
    rawSourceDocuments: bundled.rawDocuments.length,
    inventoryChars: inventory.length,
    evidencePackChars: evidenceFormatted.length,
    evidenceContextBudgetChars: packingStats.bundleCharCap,
    taskPromptChars: FORENSIC_ACCOUNTING_TASK_PROMPT.length,
    userMessageChars: user.length,
    systemMessageChars: FORENSIC_ACCOUNTING_SYSTEM_PROMPT.length,
    evidenceQueryLines,
    retrievalUsed: bundled.retrievalUsed,
    packingStats,
    userMessageBreakdown,
  };

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, FORENSIC_ACCOUNTING_SYSTEM_PROMPT, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  return {
    ok: true,
    markdown: result.text.trim(),
    sourcePack: evidenceFormatted,
    sentSystemMessage: FORENSIC_ACCOUNTING_SYSTEM_PROMPT,
    sentUserMessage: user,
    diagnostics,
    sourceFingerprint: bundled.sourceFingerprint,
  };
}
