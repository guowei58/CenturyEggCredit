import {
  buildCreditDecisionDashboardSystemPrompt,
  buildCreditDecisionDashboardUserPrompt,
} from "@/data/credit-decision-dashboard-prompt";
import { pickBestConfiguredLiteraryProvider } from "@/lib/creditMemo/generateLiteraryReferences";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "./evidencePack";
import type { CreditDecisionDashboardInputs, CreditDecisionDashboardPayload } from "./creditDecisionDashboardTypes";
import { parseCreditDecisionDashboardJson } from "./parseCreditDecisionDashboardJson";
import { readCreditDecisionDashboardSourcePack } from "./readCreditDecisionDashboardSourcePack";
import { loadCreditMemoConfig } from "./config";
import type { CreditMemoProject } from "./types";

type CreditMemoResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

const EVIDENCE_QUERY = [
  "Credit buy hold pass short recovery liquidity refinancing covenant LME priming",
  "Capital structure maturity wall EBITDA free cash flow leverage security ranking",
  "Risk downside bear case management guidance customer margin competitive",
].join("\n");

export const pickBestConfiguredCreditDashboardProvider = pickBestConfiguredLiteraryProvider;

export async function runCreditDecisionDashboardGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  inputs: CreditDecisionDashboardInputs;
  provider: AiProvider;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
  temperature?: number;
}): Promise<
  | { ok: true; dashboard: CreditDecisionDashboardPayload; sourcePack: string; rawJson: string }
  | { ok: false; error: string }
> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  const savedPack = await readCreditDecisionDashboardSourcePack(params.project.ticker, params.userId);
  const inventoryParts: string[] = [];
  const materialParts: string[] = [];

  if (savedPack) {
    materialParts.push(savedPack.materials);
    inventoryParts.push(savedPack.inventory);
  }

  const txtSourceIds = new Set(
    params.project.sources.filter((s) => s.ext.toLowerCase() === "txt" && s.parseStatus !== "skipped").map((s) => s.id)
  );

  if (materialParts.length === 0) {
    if (params.project.sources.length === 0) {
      return {
        ok: false,
        error:
          "No saved research found for this workspace. Save tab responses, generate a credit memo on **AI Memo and Deck**, and/or add work products, then try again.",
      };
    }
    if (txtSourceIds.size > 0) {
      inventoryParts.push(formatSourceInventoryList(params.project.sources.filter((s) => txtSourceIds.has(s.id))));
      materialParts.push(
        buildEvidencePackSync(params.project, {
          maxChars: cfg.maxContextChars,
          query: EVIDENCE_QUERY,
          sourceIds: txtSourceIds,
        })
      );
    } else {
      inventoryParts.push(formatSourceInventoryList(params.project.sources));
      materialParts.push(
        buildEvidencePackSync(params.project, {
          maxChars: cfg.maxContextChars,
          query: EVIDENCE_QUERY,
        })
      );
    }
  } else if (params.project.sources.length > 0) {
    inventoryParts.push(formatSourceInventoryList(params.project.sources));
    materialParts.push(
      buildEvidencePackSync(params.project, {
        maxChars: Math.min(cfg.maxContextChars, 120_000),
        query: EVIDENCE_QUERY,
      })
    );
  }

  const inventory = inventoryParts.filter(Boolean).join("\n");
  const materials = materialParts.filter(Boolean).join("\n\n");

  if (!materials.trim()) {
    return {
      ok: false,
      error: "No research materials available. Save tab responses or generate a credit memo, then try again.",
    };
  }

  const system = buildCreditDecisionDashboardSystemPrompt(params.project.ticker, {
    companyName: params.inputs.companyName || undefined,
    securityAnalyzed: params.inputs.securityAnalyzed || undefined,
    currentPrice: params.inputs.currentPrice || undefined,
    currentYieldSpread: params.inputs.currentYieldSpread || undefined,
    maturity: params.inputs.maturity || undefined,
    coupon: params.inputs.coupon || undefined,
    securityRanking: params.inputs.securityRanking || undefined,
    analystView: params.inputs.analystView || undefined,
    analystNotes: params.inputs.analystNotes || undefined,
  });
  const user = buildCreditDecisionDashboardUserPrompt({ inventory, materials });

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const result = await llmCompleteSingle(ai, system, user, {
    maxTokens: Math.max(cfg.maxOutputTokens, LLM_MAX_OUTPUT_TOKENS),
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
    temperature: params.temperature,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  const dashboard = parseCreditDecisionDashboardJson(result.text);
  if (!dashboard) {
    return {
      ok: false,
      error: "Model returned invalid JSON. Try again or switch model. Raw output was not parseable as Credit Decision Dashboard schema.",
    };
  }

  const rawJson = JSON.stringify(dashboard, null, 2);
  return { ok: true, dashboard, sourcePack: materials, rawJson };
}
