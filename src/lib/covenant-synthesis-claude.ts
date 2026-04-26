/**
 * Server-only: covenant synthesis via Claude or OpenAI.
 */

import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import { COVENANT_SYNTHESIS_SYSTEM, COVENANT_SYNTHESIS_USER_INSTRUCTIONS } from "@/data/covenant-synthesis-prompt";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

export type CovenantResolvedModels = {
  claudeModel: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel: string;
};

export async function synthesizeCovenantsMarkdown(
  userContent: string,
  provider: AiProvider,
  models: CovenantResolvedModels,
  apiKeys: LlmCallApiKeys
): Promise<{ ok: true; markdown: string } | { ok: false; error: string }> {
  const result = await llmCompleteSingle(
    provider,
    COVENANT_SYNTHESIS_SYSTEM,
    `${COVENANT_SYNTHESIS_USER_INSTRUCTIONS}\n\n---\n\n${userContent}`,
    {
      maxTokens: LLM_MAX_OUTPUT_TOKENS,
      claudeModel: models.claudeModel,
      openaiModel: models.openaiModel,
      geminiModel: models.geminiModel,
      deepseekModel: models.deepseekModel,
      apiKeys,
    }
  );

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, markdown: result.text };
}
