/**
 * LME analysis via Claude / OpenAI / Gemini / DeepSeek.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { LME_ANALYSIS_SYSTEM, LME_ANALYSIS_USER_SPEC } from "@/data/lme-analysis-prompt";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

export async function synthesizeLmeAnalysisMarkdown(
  sourcesFormatted: string,
  provider: AiProvider,
  models: CovenantResolvedModels,
  apiKeys: LlmCallApiKeys,
  responseVerbosity?: ResponseVerbosity
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const user = `${LME_ANALYSIS_USER_SPEC}\n\n---\n\nSOURCE DOCUMENTS (use as sole factual basis for debt/capital-structure claims):\n\n${sourcesFormatted}`;

  const result = await llmCompleteSingle(provider, LME_ANALYSIS_SYSTEM, user, {
    maxTokens: 24_000,
    claudeModel: models.claudeModel,
    openaiModel: models.openaiModel,
    geminiModel: models.geminiModel,
    deepseekModel: models.deepseekModel,
    apiKeys,
    responseVerbosity,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, markdown: result.text };
}
