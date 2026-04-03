/**
 * Dispatch single or multi-turn completions to Claude, OpenAI, Gemini, or local Ollama.
 */

import type { AiProvider } from "@/lib/ai-provider";
import { callClaude, callClaudeConversation, type ClaudeResult } from "@/lib/anthropic";
import type { ChatConversationTurn } from "@/lib/chat-multimodal-types";
import { conversationHasNonTextMultimodal, conversationHasPdf } from "@/lib/chat-multimodal-types";
import { callGemini, callGeminiConversation, type GeminiResult } from "@/lib/gemini";
import { callOpenAI, callOpenAIConversation, type OpenAIResult } from "@/lib/openai";
import { callOllama, callOllamaConversation, type OllamaResult } from "@/lib/ollama";

export type LlmResult = ClaudeResult;

function toLlm(r: OpenAIResult | OllamaResult | GeminiResult): LlmResult {
  if (r.ok) return { ok: true, text: r.text };
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
    ollamaModel?: string;
    claudeTools?: ClaudeTools;
  } = {}
): Promise<LlmResult> {
  if (provider === "openai") {
    const r = await callOpenAI(system, user, {
      maxTokens: options.maxTokens,
      model: options.openaiModel,
    });
    return toLlm(r);
  }
  if (provider === "gemini") {
    const r = await callGemini(system, user, {
      maxTokens: options.maxTokens,
      model: options.geminiModel,
    });
    return toLlm(r);
  }
  if (provider === "ollama") {
    const r = await callOllama(system, user, {
      maxTokens: options.maxTokens,
      model: options.ollamaModel,
    });
    return toLlm(r);
  }
  return callClaude(system, user, {
    maxTokens: options.maxTokens,
    model: options.claudeModel,
    tools: options.claudeTools,
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
    ollamaModel?: string;
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
  if (provider === "ollama" && (conversationHasPdf(messages) || conversationHasNonTextMultimodal(messages))) {
    return {
      ok: false,
      error:
        "Local Ollama in OREO is text-only. Switch to Claude (PDF/images) or ChatGPT (images), or paste text instead.",
      status: 400,
    };
  }
  if (provider === "openai") {
    const r = await callOpenAIConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.openaiModel,
    });
    return toLlm(r);
  }
  if (provider === "gemini") {
    const r = await callGeminiConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.geminiModel,
    });
    return toLlm(r);
  }
  if (provider === "ollama") {
    const r = await callOllamaConversation(system, messages, {
      maxTokens: options.maxTokens,
      model: options.ollamaModel,
    });
    return toLlm(r);
  }
  return callClaudeConversation(system, messages, {
    maxTokens: options.maxTokens,
    model: options.claudeModel,
  });
}

export function isProviderConfigured(provider: AiProvider): boolean {
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY?.trim());
  if (provider === "gemini") return Boolean(process.env.GEMINI_API_KEY?.trim());
  if (provider === "ollama") return true;
  return Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}
