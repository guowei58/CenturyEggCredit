import { NextResponse } from "next/server";
import { normalizeAiProvider, type AiProvider } from "@/lib/ai-provider";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { WEB_SEARCH_TOOL, isClaudeWebSearchToolEnabled } from "@/lib/anthropic";
import { isGeminiGoogleSearchEnabled } from "@/lib/gemini";
import { isOpenAiWebSearchEnabled } from "@/lib/openai";

export const dynamic = "force-dynamic";
/** Align with `anthropicFetchTimeoutMs()` default (300s) so Claude can finish large tab prompts. */
export const maxDuration = 300;

const MAX_USER_CHARS = 400_000;
const MAX_SYSTEM_CHARS = 24_000;

const DEFAULT_SYSTEM = `You are a senior credit and equity research assistant. The user message is a prompt they prepared for analysis in their workflow.

Answer thoroughly. Use Markdown (headings, lists, tables) when it improves clarity. Follow any output structure the user asked for. Do not invent facts; if information is missing, say so briefly.

The server prepends the current date/time and adds rigor instructions (self-check; for Claude with web search—verify recent facts when needed). Treat those as binding.`;

/**
 * POST { provider, userPrompt, systemPrompt?, maxTokens?, claudeModel?, openaiModel?, geminiModel?, deepseekModel? }
 * — one-shot completion for “prompt sidebar” tabs (uses server API keys).
 */
export async function POST(request: Request) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, responseVerbosity } = llmAuth.ctx;

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
  const user = userRaw.trim();
  if (!user) {
    return NextResponse.json({ error: "userPrompt is required" }, { status: 400 });
  }
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
  const result = await llmCompleteSingle(provider, system, user, {
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
    responseVerbosity,
  });

  if (!result.ok) {
    const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const msg = result.error.length > 600 ? "Model request failed" : result.error;
    return NextResponse.json({ error: msg }, { status });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
