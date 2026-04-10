/**
 * Server-only: covenant synthesis via Claude or OpenAI.
 */

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
      maxTokens: 16_000,
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
