/**
 * Server-only: merge optional client model overrides with env defaults.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { sanitizeClientModelId } from "@/lib/ai-model-options";
import { getOllamaModel } from "@/lib/ollama";

export type ModelOverrideBody = {
  claudeModel?: unknown;
  openaiModel?: unknown;
  geminiModel?: unknown;
  ollamaModel?: unknown;
};

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
    ollamaModel:
      sanitizeClientModelId(b.ollamaModel) ||
      process.env.OLLAMA_COMMITTEE_MODEL?.trim() ||
      getOllamaModel(),
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
    ollamaModel:
      sanitizeClientModelId(b.ollamaModel) ||
      process.env.OLLAMA_COVENANT_MODEL?.trim() ||
      getOllamaModel(),
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
    ollamaModel:
      sanitizeClientModelId(b.ollamaModel) ||
      process.env.OLLAMA_CREDIT_MEMO_MODEL?.trim() ||
      getOllamaModel(),
  };
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
    ollamaModel:
      provider === "ollama" && m ? m : process.env.OLLAMA_OVERVIEW_MODEL?.trim() || getOllamaModel(),
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
    ollamaModel:
      provider === "ollama" && m ? m : process.env.OLLAMA_PRESENTATIONS_MODEL?.trim() || getOllamaModel(),
  };
}
