/**
 * Dispatch single or multi-turn completions to Claude, OpenAI, Gemini, or DeepSeek.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { callClaude, callClaudeConversation, type ClaudeResult } from "@/lib/anthropic";
import type { ChatConversationTurn } from "@/lib/chat-multimodal-types";
import { conversationHasNonTextMultimodal, conversationHasPdf } from "@/lib/chat-multimodal-types";
import {
  callDeepSeek,
  callDeepSeekConversation,
  type DeepSeekResult,
} from "@/lib/deepseek";
import { callGemini, callGeminiConversation, type GeminiResult } from "@/lib/gemini";
import { callOpenAI, callOpenAIConversation, type OpenAIResult } from "@/lib/openai";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { isProviderConfiguredForKeys } from "@/lib/user-llm-keys";

export type LlmResult = ClaudeResult;

function toLlm(r: OpenAIResult | DeepSeekResult | GeminiResult): LlmResult {
  if (r.ok) {
    if ("outputTruncated" in r && r.outputTruncated) {
      return { ok: true, text: r.text, outputTruncated: true };
    }
    return { ok: true, text: r.text };
  }
  return { ok: false, error: r.error, status: r.status };
}

type ClaudeTools = readonly { type: string; name: string; max_uses?: number }[];

export async function llmCompleteSingle(
  provider: AiProvider,
  system: string,
  user: string,
  options: {
    maxTokens?: number;
    claudeModel?: string;
    openaiModel?: string;
    geminiModel?: string;
    deepseekModel?: string;
    claudeTools?: ClaudeTools;
    /** OpenAI only: max wait for HTTP response (large XBRL jobs). */
    openaiFetchTimeoutMs?: number;
    /**
     * When set, cloud providers use only these keys (no env fallback).
     * When omitted, cloud providers read from process.env (scripts / legacy).
     */
    apiKeys?: LlmCallApiKeys;
    /** OpenAI Chat Completions web search (tab prompts / AI Chat when enabled server-side). */
    openaiWebSearch?: boolean;
    /** Gemini native Google Search grounding (tab prompts / AI Chat when enabled server-side). */
    geminiGoogleSearch?: boolean;
  } = {}
): Promise<LlmResult> {
  const ak = options.apiKeys;
  if (provider === "openai") {
    const r = await callOpenAI(system, user, {
      maxTokens: options.maxTokens,
      model: options.openaiModel,
      fetchTimeoutMs: options.openaiFetchTimeoutMs,
      apiKeys: ak,
      webSearch: options.openaiWebSearch === true,
    });
    return toLlm(r);
  }
  if (provider === "gemini") {
    const r = await callGemini(system, user, {
      maxTokens: options.maxTokens,
      model: options.geminiModel,
      apiKeys: ak,
      googleSearch: options.geminiGoogleSearch === true,
    });
    return toLlm(r);
  }
  if (provider === "deepseek") {
    const r = await callDeepSeek(system, user, {
      maxTokens: options.maxTokens,
      model: options.deepseekModel,
      apiKeys: ak,
    });
    return toLlm(r);
  }
  return callClaude(system, user, {
    maxTokens: options.maxTokens,
    model: options.claudeModel,
    tools: options.claudeTools,
    apiKeys: ak,
  });
}

export async function llmCompleteConversation(
  provider: AiProvider,
  system: string,
  messages: ChatConversationTurn[],
  options: {
    maxTokens?: number;
    claudeModel?: string;
    openaiModel?: string;
    geminiModel?: string;
    deepseekModel?: string;
    claudeTools?: ClaudeTools;
    openaiFetchTimeoutMs?: number;
    apiKeys?: LlmCallApiKeys;
    openaiWebSearch?: boolean;
    geminiGoogleSearch?: boolean;
  } = {}
): Promise<LlmResult> {
  if ((provider === "openai" || provider === "gemini") && conversationHasPdf(messages)) {
    return {
      ok: false,
      error:
        "PDF attachments work with Claude only in OREO. Switch the model to Claude above, or paste text from the PDF.",
      status: 400,
    };
  }
  if (provider === "deepseek" && (conversationHasPdf(messages) || conversationHasNonTextMultimodal(messages))) {
    return {
      ok: false,
      error:
        "DeepSeek in OREO is text-only. Switch to Claude (PDF/images) or ChatGPT (images), or paste text instead.",
      status: 400,
    };
  }
  const ak = options.apiKeys;
  if (provider === "openai") {
    const r = await callOpenAIConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.openaiModel,
      fetchTimeoutMs: options.openaiFetchTimeoutMs,
      apiKeys: ak,
      webSearch: options.openaiWebSearch === true,
    });
    return toLlm(r);
  }
  if (provider === "gemini") {
    const r = await callGeminiConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.geminiModel,
      apiKeys: ak,
      googleSearch: options.geminiGoogleSearch === true,
    });
    return toLlm(r);
  }
  if (provider === "deepseek") {
    const r = await callDeepSeekConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.deepseekModel,
      apiKeys: ak,
    });
    return toLlm(r);
  }
  return callClaudeConversation(system, messages, {
    maxTokens: options.maxTokens,
    model: options.claudeModel,
    tools: options.claudeTools,
    apiKeys: ak,
  });
}

/**
 * When `keys` is omitted, uses environment variables only (legacy / scripts).
 * When `keys` is provided, uses only that bundle (no env fallback for missing entries).
 */
export function isProviderConfigured(provider: AiProvider, keys?: LlmCallApiKeys): boolean {
  if (keys === undefined) {
    if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
    if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY?.trim());
    if (provider === "deepseek") return Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
  }
  return isProviderConfiguredForKeys(provider, keys);
}
