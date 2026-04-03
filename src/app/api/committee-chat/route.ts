import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveProvider } from "@/lib/ai-provider";
import { parseCommitteeChatMessages } from "@/lib/committee-chat-parse";
import { COMMITTEE_CHAT_SYSTEM } from "@/data/committee-chat-prompt";
import { buildCommitteeOreoContext } from "@/lib/committee-ticker-context";
import { isProviderConfigured, llmCompleteConversation } from "@/lib/llm-router";
import { checkOllamaHealth } from "@/lib/ollama";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sanitizeTicker(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s || s.length > 12) return null;
  return s;
}

/**
 * GET — whether AI Chat can call Anthropic / OpenAI / Gemini / Ollama (for UI).
 */
export async function GET() {
  const ollamaHealth = await checkOllamaHealth();
  return NextResponse.json({
    anthropicConfigured: Boolean(process.env.ANTHROPIC_API_KEY?.trim()),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY?.trim()),
    geminiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
    ollama: {
      status: ollamaHealth.status,
      model: ollamaHealth.model,
    },
  });
}

/**
 * POST { messages, ticker?, provider?, includeOreoContext?, claudeModel?, openaiModel?, geminiModel?, ollamaModel? } — AI Chat; returns assistant text.
 * When ticker is set and includeOreoContext is not false, saved OREO text for that ticker is injected into the system prompt.
 * Multi-user rooms can be added later by persisting `messages` server-side with a room id.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const b = body as {
    messages?: unknown;
    ticker?: unknown;
    provider?: unknown;
    includeOreoContext?: unknown;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    ollamaModel?: unknown;
  };
  const provider = resolveProvider(b.provider);
  if (!isProviderConfigured(provider)) {
    const hint =
      provider === "openai"
        ? "OPENAI_API_KEY is not set. Add it to .env.local to use ChatGPT in AI Chat."
        : provider === "gemini"
          ? "GEMINI_API_KEY is not set. Add it to .env.local to use Gemini in AI Chat."
          : "ANTHROPIC_API_KEY is not set. Add it to .env.local to use Claude in AI Chat.";
    return NextResponse.json({ error: hint }, { status: 503 });
  }
  if (provider === "ollama") {
    const health = await checkOllamaHealth();
    if (health.status === "disconnected") {
      return NextResponse.json(
        { error: "Ollama is not reachable. Run `ollama serve` (default http://localhost:11434)." },
        { status: 503 }
      );
    }
    if (health.status === "model_missing") {
      return NextResponse.json(
        {
          error: `Ollama model "${health.model}" is not installed. Run: ollama pull ${health.model}`,
        },
        { status: 503 }
      );
    }
    if (health.status === "error") {
      return NextResponse.json(
        { error: health.detail?.slice(0, 200) ?? "Ollama health check failed." },
        { status: 503 }
      );
    }
  }
  const parsed = parseCommitteeChatMessages(b.messages);
  if (!Array.isArray(parsed)) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const sym = sanitizeTicker(b.ticker);
  const includeOreo = b.includeOreoContext !== false;

  const session = await auth();

  let system = COMMITTEE_CHAT_SYSTEM;
  if (sym != null) {
    system += `\n\nThe user currently has ticker **${sym}** selected in the sidebar (context only; they may ask about other names).`;
    if (includeOreo) {
      const oreoBlock = await buildCommitteeOreoContext(sym, session?.user?.id);
      if (oreoBlock) {
        system += `\n\n---\n## OREO saved workspace (ticker ${sym})\nThe following was read from this ticker's folder in OREO—saved tab responses, Credit Agreements text, and text files under Saved Documents. Use it when relevant.\n\n${oreoBlock}`;
      }
    }
  }

  const { claudeModel, openaiModel, geminiModel, ollamaModel } = resolveCommitteeChatModels(b);

  const result = await llmCompleteConversation(provider, system, parsed, {
    maxTokens: 4096,
    claudeModel,
    openaiModel,
    geminiModel,
    ollamaModel,
  });

  if (!result.ok) {
    const status =
      result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const label =
      provider === "openai"
        ? "OpenAI"
        : provider === "gemini"
          ? "Gemini"
          : provider === "ollama"
            ? "Ollama"
            : "Claude";
    const short =
      result.error.length > 500 ? `${label} request failed` : result.error;
    return NextResponse.json({ error: short }, { status: status === 400 ? 400 : status });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
