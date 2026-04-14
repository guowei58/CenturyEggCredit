import { NextResponse } from "next/server";
import { normalizeAiProvider, type AiProvider } from "@/lib/ai-provider";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import type { ChatConversationTurn, ChatUserContentPart } from "@/lib/chat-multimodal-types";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured, llmCompleteConversation, llmCompleteSingle } from "@/lib/llm-router";
import { filterAllowedSamplePublicPaths, loadPublicSampleImagesAsParts } from "@/lib/tab-prompt-sample-assets";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { WEB_SEARCH_TOOL, isClaudeWebSearchToolEnabled } from "@/lib/anthropic";
import { isGeminiGoogleSearchEnabled } from "@/lib/gemini";
import { isOpenAiWebSearchEnabled } from "@/lib/openai";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

export const dynamic = "force-dynamic";
/** Align with `anthropicFetchTimeoutMs()` default (300s) so Claude can finish large tab prompts. */
export const maxDuration = 300;

const MAX_USER_CHARS = 400_000;
const MAX_SYSTEM_CHARS = 24_000;

const DEFAULT_SYSTEM = `You are a senior credit and equity research assistant. The user message is a prompt they prepared for analysis in their workflow.

Answer thoroughly. Use Markdown (headings, lists, tables) when it improves clarity. Follow any output structure the user asked for. Do not invent facts; if information is missing, say so briefly.

The server prepends the current date/time and adds rigor instructions (self-check; for Claude with web search—verify recent facts when needed). Treat those as binding.`;

/**
 * POST { provider, userPrompt, systemPrompt?, maxTokens?, samplePublicPaths?, claudeModel?, openaiModel?, geminiModel?, deepseekModel? }
 * Optional `samplePublicPaths` (e.g. ["/org-chart-sample-lumen.png"]) attaches those /public images for vision-capable providers; DeepSeek rejects multimodal.
 * — one-shot completion for “prompt sidebar” tabs (uses server API keys).
 */
export async function POST(request: Request) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle } = llmAuth.ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    provider?: unknown;
    userPrompt?: unknown;
    systemPrompt?: unknown;
    maxTokens?: unknown;
    samplePublicPaths?: unknown;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  };

  const provider = normalizeAiProvider(b.provider) as AiProvider | null;
  if (!provider) {
    return NextResponse.json({ error: "provider must be claude, openai, gemini, or deepseek" }, { status: 400 });
  }

  const userRaw = typeof b.userPrompt === "string" ? b.userPrompt : "";
  const trimmedUser = userRaw.trim();
  if (!trimmedUser) {
    return NextResponse.json({ error: "userPrompt is required" }, { status: 400 });
  }
  if (trimmedUser.length > MAX_USER_CHARS) {
    return NextResponse.json(
      { error: `Prompt too large (max ${MAX_USER_CHARS.toLocaleString()} characters).` },
      { status: 400 }
    );
  }

  const user = withPromptBenchmarkNotice(trimmedUser);
  if (user.length > MAX_USER_CHARS) {
    return NextResponse.json(
      { error: `Prompt too large (max ${MAX_USER_CHARS.toLocaleString()} characters).` },
      { status: 400 }
    );
  }

  const system =
    typeof b.systemPrompt === "string" && b.systemPrompt.trim()
      ? b.systemPrompt.trim().slice(0, MAX_SYSTEM_CHARS)
      : DEFAULT_SYSTEM;

  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  let maxTokens = 8192;
  if (typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens)) {
    maxTokens = Math.min(32_768, Math.max(256, Math.round(b.maxTokens)));
  }

  const models = resolveCommitteeChatModels(b);
  const samplePaths = filterAllowedSamplePublicPaths(b.samplePublicPaths);

  if (samplePaths.length > 0 && provider === "deepseek") {
    return NextResponse.json(
      {
        error:
          "DeepSeek in OREO is text-only. Switch to Claude or ChatGPT (or Gemini) to send reference sample images with this prompt.",
      },
      { status: 400 }
    );
  }

  let messages: ChatConversationTurn[] | null = null;
  if (samplePaths.length > 0) {
    const loaded = await loadPublicSampleImagesAsParts(samplePaths);
    if (!loaded.ok) {
      return NextResponse.json({ error: loaded.error }, { status: 400 });
    }
    const content: ChatUserContentPart[] = [{ type: "text", text: user }, ...loaded.parts];
    messages = [{ role: "user", content }];
  }

  const result =
    messages !== null
      ? await llmCompleteConversation(provider, system, messages, {
          maxTokens,
          claudeModel: models.claudeModel,
          openaiModel: models.openaiModel,
          geminiModel: models.geminiModel,
          deepseekModel: models.deepseekModel,
          claudeTools:
            provider === "claude" && isClaudeWebSearchToolEnabled() ? [WEB_SEARCH_TOOL] : undefined,
          openaiWebSearch: provider === "openai" && isOpenAiWebSearchEnabled(),
          geminiGoogleSearch: provider === "gemini" && isGeminiGoogleSearchEnabled(),
          apiKeys: bundle,
        })
      : await llmCompleteSingle(provider, system, user, {
          maxTokens,
          claudeModel: models.claudeModel,
          openaiModel: models.openaiModel,
          geminiModel: models.geminiModel,
          deepseekModel: models.deepseekModel,
          claudeTools:
            provider === "claude" && isClaudeWebSearchToolEnabled() ? [WEB_SEARCH_TOOL] : undefined,
          openaiWebSearch: provider === "openai" && isOpenAiWebSearchEnabled(),
          geminiGoogleSearch: provider === "gemini" && isGeminiGoogleSearchEnabled(),
          apiKeys: bundle,
        });

  if (!result.ok) {
    const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const msg = result.error.length > 600 ? "Model request failed" : result.error;
    return NextResponse.json({ error: msg }, { status });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
