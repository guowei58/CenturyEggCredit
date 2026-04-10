import {
  FORENSIC_ACCOUNTING_SYSTEM_PROMPT,
  FORENSIC_ACCOUNTING_TASK_PROMPT,
} from "@/data/forensic-accounting-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
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

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

const EVIDENCE_QUERY = [
  "10-K 10-Q 8-K SEC filing financial statements",
  "balance sheet income statement cash flow statement",
  "footnotes MD&A management discussion analysis",
  "revenue recognition receivables inventory goodwill impairment",
  "deferred tax pension lease accounting segment",
  "related party contingent liability reserve allowance",
  "earnings release presentation non-GAAP adjusted EBITDA",
  "auditor opinion internal control covenant liquidity",
  "proxy annual report supplemental lender",
].join("\n");

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
  project: CreditMemoProject;
  provider: AiProvider;
  companyName?: string;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
  responseVerbosity?: ResponseVerbosity;
}): Promise<{ ok: true; markdown: string; sourcePack: string } | { ok: false; error: string }> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: "No sources ingested. Run ingest after selecting a folder with files." };
  }

  const inventory = formatSourceInventoryList(params.project.sources);

  const PROMPT_TOKEN_LIMIT =
    ai === "openai" || ai === "gemini" || ai === "deepseek" ? 190_000 : 180_000;
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(FORENSIC_ACCOUNTING_SYSTEM_PROMPT.length);

  let maxEvidenceChars = cfg.maxContextChars;
  let evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: EVIDENCE_QUERY });
  let user = buildUserPrompt({
    ticker: params.project.ticker,
    companyName: params.companyName,
    inventory,
    evidence,
  });

  for (let i = 0; i < 8; i++) {
    const est = SYSTEM_TOKEN_EST + estimateTokensFromChars(user.length);
    if (est <= PROMPT_TOKEN_LIMIT) break;
    maxEvidenceChars = Math.max(40_000, Math.floor(maxEvidenceChars * 0.8));
    evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: EVIDENCE_QUERY });
    user = buildUserPrompt({
      ticker: params.project.ticker,
      companyName: params.companyName,
      inventory,
      evidence,
    });
  }

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, FORENSIC_ACCOUNTING_SYSTEM_PROMPT, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
    responseVerbosity: params.responseVerbosity,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  return { ok: true, markdown: result.text.trim(), sourcePack: evidence };
}
