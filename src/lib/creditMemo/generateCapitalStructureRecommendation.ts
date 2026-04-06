import {
  CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT,
  CAP_STRUCTURE_PROTECTION_TASK_PROMPT,
} from "@/data/cap-structure-recommendation-prompt";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import { loadCreditMemoConfig } from "./config";
import type { CreditMemoProject } from "./types";

type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  ollamaModel: string;
};

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

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
}): Promise<{ ok: true; markdown: string; sourcePack: string } | { ok: false; error: string }> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai)) {
    return {
      ok: false,
      error:
        ai === "openai"
          ? "OPENAI_API_KEY not configured. Add to .env.local."
          : ai === "gemini"
            ? "GEMINI_API_KEY not configured. Add to .env.local."
            : "ANTHROPIC_API_KEY not configured. Add to .env.local.",
    };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: "No sources ingested. Run ingest after selecting a folder with files." };
  }

  const inventory = formatSourceInventoryList(params.project.sources);

  const PROMPT_TOKEN_LIMIT = ai === "openai" || ai === "gemini" ? 190_000 : 180_000;
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT.length);

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

  const { claudeModel, openaiModel, geminiModel, ollamaModel } = params.models;

  const result = await llmCompleteSingle(ai, CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT, user, {
    maxTokens: cfg.maxOutputTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    ollamaModel,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  return { ok: true, markdown: result.text.trim(), sourcePack: evidence };
}
