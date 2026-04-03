import { NextResponse } from "next/server";
import { normalizeAiProvider, type AiProvider } from "@/lib/ai-provider";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { checkOllamaHealth } from "@/lib/ollama";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const MAX_USER_CHARS = 400_000;
const MAX_SYSTEM_CHARS = 24_000;

const DEFAULT_SYSTEM = `You are a senior credit and equity research assistant. The user message is a prompt they prepared for analysis in their workflow.

Answer thoroughly. Use Markdown (headings, lists, tables) when it improves clarity. Follow any output structure the user asked for. Do not invent facts; if information is missing, say so briefly.`;

/**
 * POST { provider, userPrompt, systemPrompt?, maxTokens?, claudeModel?, openaiModel?, geminiModel?, ollamaModel? }
 * — one-shot completion for “prompt sidebar” tabs (uses server API keys).
 */
export async function POST(request: Request) {
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
    ollamaModel?: unknown;
  };

  const provider = normalizeAiProvider(b.provider) as AiProvider | null;
  if (!provider) {
    return NextResponse.json({ error: "provider must be claude, openai, gemini, or ollama" }, { status: 400 });
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

  if (!isProviderConfigured(provider)) {
    const hint =
      provider === "openai"
        ? "OPENAI_API_KEY is not set in .env.local."
        : provider === "gemini"
          ? "GEMINI_API_KEY is not set in .env.local."
          : provider === "ollama"
            ? "Ollama is selected but local setup may be missing."
            : "ANTHROPIC_API_KEY is not set in .env.local.";
    return NextResponse.json({ error: hint }, { status: 503 });
  }

  if (provider === "ollama") {
    const health = await checkOllamaHealth();
    if (health.status === "disconnected") {
      return NextResponse.json({ error: "Ollama is not reachable. Run `ollama serve`." }, { status: 503 });
    }
    if (health.status === "model_missing") {
      return NextResponse.json(
        { error: `Ollama model "${health.model}" is not installed. Run: ollama pull ${health.model}` },
        { status: 503 }
      );
    }
    if (health.status === "error") {
      return NextResponse.json({ error: health.detail?.slice(0, 200) ?? "Ollama check failed." }, { status: 503 });
    }
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
    ollamaModel: models.ollamaModel,
  });

  if (!result.ok) {
    const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const msg = result.error.length > 600 ? "Model request failed" : result.error;
    return NextResponse.json({ error: msg }, { status });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
