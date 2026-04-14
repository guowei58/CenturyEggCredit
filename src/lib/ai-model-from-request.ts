/**
 * Server-only: merge optional client model overrides with env defaults.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { sanitizeClientModelId } from "@/lib/ai-model-options";
import { getDeepSeekModel } from "@/lib/deepseek";
import { OPENAI_DEFAULT_MODEL } from "@/lib/openai";

export type ModelOverrideBody = {
  claudeModel?: unknown;
  openaiModel?: unknown;
  geminiModel?: unknown;
  deepseekModel?: unknown;
  /** @deprecated legacy body field when provider was Ollama */
  ollamaModel?: unknown;
};

function clientDeepseekModelId(b: ModelOverrideBody): string | undefined {
  return (
    sanitizeClientModelId(b.deepseekModel) || sanitizeClientModelId(b.ollamaModel)
  );
}

export function resolveCommitteeChatModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_COMMITTEE_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-haiku-4-5-20251001",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_COMMITTEE_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_COMMITTEE_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_COMMITTEE_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

/** Same env fallbacks as covenants; override with ANTHROPIC_LME_ANALYSIS_MODEL etc. if set. */
export function resolveLmeAnalysisModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_LME_ANALYSIS_MODEL?.trim() ||
      process.env.ANTHROPIC_COVENANT_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-haiku-4-5-20251001",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_LME_ANALYSIS_MODEL?.trim() ||
      process.env.OPENAI_COVENANT_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_LME_ANALYSIS_MODEL?.trim() ||
      process.env.GEMINI_COVENANT_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_LME_ANALYSIS_MODEL?.trim() ||
      process.env.DEEPSEEK_COVENANT_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

export function resolveCovenantModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_COVENANT_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-haiku-4-5-20251001",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_COVENANT_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_COVENANT_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_COVENANT_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

export function resolveCreditMemoModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_CREDIT_MEMO_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-sonnet-4-20250514",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_CREDIT_MEMO_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

export type CreditMemoResolvedModelsBundle = ReturnType<typeof resolveCreditMemoModels>;

/** Stronger defaults for one-shot literary / analogy work; optional \`*_LITERARY_REFERENCES_MODEL\` env per provider. */
export function resolveLiteraryReferencesModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.ANTHROPIC_CREDIT_MEMO_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-sonnet-4-6",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.OPENAI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.GEMINI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.DEEPSEEK_CREDIT_MEMO_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

/** Same pattern as literary tab; optional \`*_BIBLICAL_REFERENCES_MODEL\` env per provider. */
export function resolveBiblicalReferencesModels(b: ModelOverrideBody) {
  return {
    claudeModel:
      sanitizeClientModelId(b.claudeModel) ||
      process.env.ANTHROPIC_BIBLICAL_REFERENCES_MODEL?.trim() ||
      process.env.ANTHROPIC_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.ANTHROPIC_CREDIT_MEMO_MODEL?.trim() ||
      process.env.ANTHROPIC_MODEL?.trim() ||
      "claude-sonnet-4-6",
    openaiModel:
      sanitizeClientModelId(b.openaiModel) ||
      process.env.OPENAI_BIBLICAL_REFERENCES_MODEL?.trim() ||
      process.env.OPENAI_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.OPENAI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.OPENAI_MODEL?.trim() ||
      undefined,
    geminiModel:
      sanitizeClientModelId(b.geminiModel) ||
      process.env.GEMINI_BIBLICAL_REFERENCES_MODEL?.trim() ||
      process.env.GEMINI_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.GEMINI_CREDIT_MEMO_MODEL?.trim() ||
      process.env.GEMINI_MODEL?.trim() ||
      undefined,
    deepseekModel:
      clientDeepseekModelId(b) ||
      process.env.DEEPSEEK_BIBLICAL_REFERENCES_MODEL?.trim() ||
      process.env.DEEPSEEK_LITERARY_REFERENCES_MODEL?.trim() ||
      process.env.DEEPSEEK_CREDIT_MEMO_MODEL?.trim() ||
      getDeepSeekModel(),
  };
}

const GEMINI_CREDIT_MEMO_MODEL_FALLBACK = "gemini-2.5-flash-lite";

/** Exact model id used for this provider after env + request overrides (for audit / library UI). */
export function creditMemoPrimaryModelId(provider: AiProvider, models: CreditMemoResolvedModelsBundle): string {
  if (provider === "claude") return models.claudeModel;
  if (provider === "openai") {
    return models.openaiModel ?? (process.env.OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL);
  }
  if (provider === "gemini") {
    return models.geminiModel ?? (process.env.GEMINI_MODEL?.trim() || GEMINI_CREDIT_MEMO_MODEL_FALLBACK);
  }
  return models.deepseekModel;
}

/** `model` query applies only to the selected `provider` (GET overview / presentations). */
export function resolveOverviewLlmModels(provider: AiProvider, queryModel: string | null) {
  const m = sanitizeClientModelId(queryModel);
  return {
    claudeModel:
      provider === "claude" && m ? m : process.env.ANTHROPIC_MODEL?.trim() || undefined,
    openaiModel:
      provider === "openai" && m
        ? m
        : process.env.OPENAI_OVERVIEW_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || undefined,
    geminiModel:
      provider === "gemini" && m
        ? m
        : process.env.GEMINI_OVERVIEW_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || undefined,
    deepseekModel:
      provider === "deepseek" && m ? m : process.env.DEEPSEEK_OVERVIEW_MODEL?.trim() || getDeepSeekModel(),
  };
}

export function resolvePresentationLlmModels(provider: AiProvider, queryModel: string | null) {
  const m = sanitizeClientModelId(queryModel);
  return {
    claudeModel:
      provider === "claude" && m
        ? m
        : process.env.ANTHROPIC_PRESENTATIONS_MODEL?.trim() || "claude-opus-4-6",
    openaiModel:
      provider === "openai" && m
        ? m
        : process.env.OPENAI_PRESENTATIONS_MODEL?.trim() || process.env.OPENAI_MODEL?.trim() || undefined,
    geminiModel:
      provider === "gemini" && m
        ? m
        : process.env.GEMINI_PRESENTATIONS_MODEL?.trim() || process.env.GEMINI_MODEL?.trim() || undefined,
    deepseekModel:
      provider === "deepseek" && m ? m : process.env.DEEPSEEK_PRESENTATIONS_MODEL?.trim() || getDeepSeekModel(),
  };
}
