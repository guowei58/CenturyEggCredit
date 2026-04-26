import {
  CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT,
  CAP_STRUCTURE_PROTECTION_TASK_PROMPT,
} from "@/data/cap-structure-recommendation-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import { loadCreditMemoConfig } from "./config";
import type { CreditMemoProject } from "./types";

type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

const EVIDENCE_QUERY = [
  "Capital structure table tranches maturities coupons spreads",
  "Revolver term loan first lien second lien secured unsecured notes",
  "Indenture credit agreement covenants guarantees collateral intercreditor",
  "Recovery liquidity runway maturity wall refinancing LME priming uptiering",
  "SEC filings 10-K 10-Q 8-K earnings transcript presentation",
  "Ratings agency news org chart subsidiary holdco opco",
  "Historical financials EBITDA leverage FCF working capital",
  "Equity preferred convertible warrants CVR",
].join("\n");

function buildUserPrompt(params: { ticker: string; companyName?: string; inventory: string; evidence: string }): string {
  const { ticker, companyName, inventory, evidence } = params;
  const co = companyName?.trim() ? `Company: ${companyName.trim()}\n` : "";
  return `
# TICKER
${ticker}
${co}
# TASK
${CAP_STRUCTURE_PROTECTION_TASK_PROMPT}

# FILE INVENTORY
${inventory}

# EVIDENCE (SOURCE PACK)
${evidence}

---
Produce the full output in Markdown now, following the task format exactly. Cite sources inline for all material facts and figures as specified in your system rules.
`.trim();
}

export async function runCapitalStructureRecommendationGeneration(params: {
  project: CreditMemoProject;
  provider: AiProvider;
  companyName?: string;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
}): Promise<{ ok: true; markdown: string; sourcePack: string } | { ok: false; error: string }> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: 'Please click on "Refresh sources"' };
  }

  const inventory = formatSourceInventoryList(params.project.sources);

  const evidence = buildEvidencePackSync(params.project, { maxChars: cfg.maxContextChars, query: EVIDENCE_QUERY });
  const user = buildUserPrompt({
    ticker: params.project.ticker,
    companyName: params.companyName,
    inventory,
    evidence,
  });

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT, user, {
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

  return { ok: true, markdown: result.text.trim(), sourcePack: evidence };
}
