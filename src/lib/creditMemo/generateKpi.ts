import { KPI_SYSTEM_PROMPT, KPI_TASK_PROMPT } from "@/data/kpi-prompt";
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
  "KPI key performance indicator operating metric revenue driver cost driver",
  "net adds churn ARPU subscribers volume units utilization load factor occupancy RASM CASM yield",
  "pricing mix margin unit economics contribution margin take rate bookings backlog",
  "capex intensity opex run-rate cost savings productivity",
  "management commentary said we expect guidance",
].join("\n");

function buildUserPrompt(params: { ticker: string; companyName?: string; inventory: string; evidence: string }): string {
  const { ticker, companyName, inventory, evidence } = params;
  const co = companyName?.trim() ? `Company: ${companyName.trim()}\n` : "";
  return `
# TICKER
${ticker}
${co}
# TASK
${KPI_TASK_PROMPT}

# FILE INVENTORY
${inventory}

# EVIDENCE (SOURCE PACK)
${evidence}

---
Produce the full output in Markdown now. Follow the output rules exactly.
`.trim();
}

export async function runKpiGeneration(params: {
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
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(KPI_SYSTEM_PROMPT.length);

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

  const result = await llmCompleteSingle(ai, KPI_SYSTEM_PROMPT, user, {
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

