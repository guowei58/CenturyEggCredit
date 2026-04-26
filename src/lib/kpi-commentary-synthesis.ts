/**
 * KPI commentary via Claude / OpenAI / Gemini / DeepSeek — same user-message shape as LME
 * (task block + SOURCE DOCUMENTS bridge + formatted sources).
 */

import { KPI_SYSTEM_PROMPT, KPI_TASK_PROMPT } from "@/data/kpi-prompt";
import { LME_USER_MESSAGE_SOURCE_BRIDGE, type LmeUserMessageCharBreakdown } from "@/lib/lme-analysis-synthesis";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import type { AiProvider } from "@/lib/ai-provider";
import { llmCompleteSingle } from "@/lib/llm-router";
import type { CovenantResolvedModels } from "@/lib/covenant-synthesis-claude";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";

const KPI_USER_CLOSING = `

---
Produce the full output in Markdown now. Follow the output rules exactly.`;

function buildKpiTaskSpecBlock(ticker: string, companyName?: string): string {
  const co = companyName?.trim() ? `Company: ${companyName.trim()}\n` : "";
  return `# TICKER
${ticker}
${co}# TASK
${KPI_TASK_PROMPT}${KPI_USER_CLOSING}`;
}

export type KpiCommentaryUserMessageBreakdown = LmeUserMessageCharBreakdown;

export async function synthesizeKpiCommentaryMarkdown(
  sourcesFormatted: string,
  ticker: string,
  companyName: string | undefined,
  provider: AiProvider,
  models: CovenantResolvedModels,
  apiKeys: LlmCallApiKeys
): Promise<
  | {
      ok: true;
      markdown: string;
      sentSystemMessage: string;
      sentUserMessage: string;
      userMessageBreakdown: KpiCommentaryUserMessageBreakdown;
    }
  | { ok: false; error: string }
> {
  const taskSpec = buildKpiTaskSpecBlock(ticker, companyName);
  const user = `${taskSpec}${LME_USER_MESSAGE_SOURCE_BRIDGE}${sourcesFormatted}`;
  const userMessageBreakdown: KpiCommentaryUserMessageBreakdown = {
    taskSpecChars: taskSpec.length,
    bridgeChars: LME_USER_MESSAGE_SOURCE_BRIDGE.length,
    formattedSourcesChars: sourcesFormatted.length,
    totalUserMessageChars: user.length,
  };

  const cfg = loadCreditMemoConfig();
  const maxTokens = Math.min(cfg.maxOutputTokens, LLM_MAX_OUTPUT_TOKENS);

  const result = await llmCompleteSingle(provider, KPI_SYSTEM_PROMPT, user, {
    maxTokens,
    claudeModel: models.claudeModel,
    openaiModel: models.openaiModel,
    geminiModel: models.geminiModel,
    deepseekModel: models.deepseekModel,
    apiKeys,
  });

  if (!result.ok) return { ok: false, error: result.error };
  return {
    ok: true,
    markdown: result.text.trim(),
    sentSystemMessage: KPI_SYSTEM_PROMPT,
    sentUserMessage: user,
    userMessageBreakdown,
  };
}
