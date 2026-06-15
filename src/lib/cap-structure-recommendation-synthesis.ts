/**
 * Capital-structure protection / recommendation via the same provider stack as LME analysis.
 */

import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import {
  CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT,
  CAP_STRUCTURE_PROTECTION_TASK_PROMPT,
} from "@/data/cap-structure-recommendation-prompt";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

import type { LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";

/** Separator + banner before pasted sources (parallel to `LME_USER_MESSAGE_SOURCE_BRIDGE`). */
export const CS_RECOMMENDATION_USER_MESSAGE_SOURCE_BRIDGE = `\n\n---\n\nSOURCE DOCUMENTS (use as sole factual basis for capital-structure protection claims):\n\n`;

export function buildCapStructureRecommendationUserMessage(sourcesFormatted: string): {
  user: string;
  userMessageBreakdown: LmeUserMessageCharBreakdown;
} {
  const taskSpec = CAP_STRUCTURE_PROTECTION_TASK_PROMPT.trim();
  const user = `${taskSpec}${CS_RECOMMENDATION_USER_MESSAGE_SOURCE_BRIDGE}${sourcesFormatted}`;
  return {
    user,
    userMessageBreakdown: {
      taskSpecChars: taskSpec.length,
      bridgeChars: CS_RECOMMENDATION_USER_MESSAGE_SOURCE_BRIDGE.length,
      formattedSourcesChars: sourcesFormatted.length,
      totalUserMessageChars: user.length,
    },
  };
}

export async function synthesizeCapStructureRecommendationMarkdown(
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
  const { user, userMessageBreakdown } = buildCapStructureRecommendationUserMessage(sourcesFormatted);

  const result = await llmCompleteSingle(provider, CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT, user, {
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
    sentSystemMessage: CAP_STRUCTURE_RECOMMENDATION_SYSTEM_PROMPT,
    sentUserMessage: user,
    userMessageBreakdown,
  };
}
