/**
 * LME analysis via Claude / OpenAI / Gemini / DeepSeek.
 */

import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import { LME_ANALYSIS_SYSTEM, LME_ANALYSIS_USER_SPEC } from "@/data/lme-analysis-prompt";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

/** Separator + banner before pasted sources (must stay in sync with `user` template below). */
export const LME_USER_MESSAGE_SOURCE_BRIDGE = `\n\n---\n\nSOURCE DOCUMENTS (use as sole factual basis for debt/capital-structure claims):\n\n`;

export type LmeUserMessageCharBreakdown = {
  taskSpecChars: number;
  bridgeChars: number;
  formattedSourcesChars: number;
  totalUserMessageChars: number;
};

export function buildLmeAnalysisUserMessage(sourcesFormatted: string): {
  user: string;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
} {
  const user = `${LME_ANALYSIS_USER_SPEC}${LME_USER_MESSAGE_SOURCE_BRIDGE}${sourcesFormatted}`;
  return {
    user,
    userMessageBreakdown: {
      taskSpecChars: LME_ANALYSIS_USER_SPEC.length,
      bridgeChars: LME_USER_MESSAGE_SOURCE_BRIDGE.length,
      formattedSourcesChars: sourcesFormatted.length,
      totalUserMessageChars: user.length,
    },
  };
}

export async function synthesizeLmeAnalysisMarkdown(
  sourcesFormatted: string,
  provider: AiProvider,
  models: CovenantResolvedModels,
  apiKeys: LlmCallApiKeys,
  temperature?: number
): Promise<
  | {
      ok: true;
      markdown: string;
      sentSystemMessage: string;
      sentUserMessage: string;
      userMessageBreakdown: LmeUserMessageCharBreakdown;
    }
  | { ok: false; error: string }
> {
  const { user, userMessageBreakdown } = buildLmeAnalysisUserMessage(sourcesFormatted);

  const result = await llmCompleteSingle(provider, LME_ANALYSIS_SYSTEM, user, {
    maxTokens: LLM_MAX_OUTPUT_TOKENS,
    claudeModel: models.claudeModel,
    openaiModel: models.openaiModel,
    geminiModel: models.geminiModel,
    deepseekModel: models.deepseekModel,
    apiKeys,
    temperature,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    markdown: result.text,
    sentSystemMessage: LME_ANALYSIS_SYSTEM,
    sentUserMessage: user,
    userMessageBreakdown,
  };
}
