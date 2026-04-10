import { NextResponse } from "next/server";
import { auth } from "@/auth";
import type { AiProvider } from "@/lib/ai-provider";
import { resolveProvider } from "@/lib/ai-provider";
import { parseCommitteeChatMessages } from "@/lib/committee-chat-parse";
import { COMMITTEE_CHAT_SYSTEM } from "@/data/committee-chat-prompt";
import { buildCommitteeOreoContext } from "@/lib/committee-ticker-context";
import { isProviderConfigured, llmCompleteConversation } from "@/lib/llm-router";
import { checkOllamaHealth } from "@/lib/ollama";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import { WEB_SEARCH_TOOL, isClaudeWebSearchToolEnabled } from "@/lib/anthropic";
import { isGeminiGoogleSearchEnabled } from "@/lib/gemini";
import { isOpenAiWebSearchEnabled } from "@/lib/openai";
import { getUserPreferences } from "@/lib/user-preferences-store";
import {
  buildLlmApiKeyBundle,
  isProviderConfiguredForKeys,
  mergeLlmCallApiKeysWithProcessEnv,
} from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sanitizeTicker(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s || s.length > 12) return null;
  return s;
}

function providerAvailableForUi(provider: AiProvider, userBundle: ReturnType<typeof buildLlmApiKeyBundle> | null): boolean {
  if (isProviderConfigured(provider)) return true;
  if (userBundle && isProviderConfiguredForKeys(provider, userBundle)) return true;
  return false;
}

/**
 * GET — whether AI Chat can call each cloud provider + Ollama (for UI). Includes User Settings keys when signed in.
 */
export async function GET() {
  const ollamaHealth = await checkOllamaHealth();
  const session = await auth();
  let userBundle: ReturnType<typeof buildLlmApiKeyBundle> | null = null;
  if (session?.user?.id) {
    const prefs = await getUserPreferences(session.user.id);
    const email = typeof session.user.email === "string" ? session.user.email : null;
    userBundle = buildLlmApiKeyBundle(email, prefs);
  }
  return NextResponse.json({
    anthropicConfigured: providerAvailableForUi("claude", userBundle),
    openaiConfigured: providerAvailableForUi("openai", userBundle),
    geminiConfigured: providerAvailableForUi("gemini", userBundle),
    deepseek: { configured: providerAvailableForUi("deepseek", userBundle) },
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
  const session = await auth();

  const apiKeysForCall =
    session?.user?.id != null
      ? mergeLlmCallApiKeysWithProcessEnv(
          buildLlmApiKeyBundle(
            typeof session.user?.email === "string" ? session.user.email : null,
            await getUserPreferences(session.user.id)
          )
        )
      : undefined;

  if (!isProviderConfigured(provider, apiKeysForCall)) {
    const hint =
      provider === "openai"
        ? "OPENAI_API_KEY is not set. Add it to .env.local to use ChatGPT in AI Chat."
        : provider === "gemini"
          ? "GEMINI_API_KEY is not set. Add it to .env.local to use Gemini in AI Chat."
          : provider === "deepseek"
            ? "DEEPSEEK_API_KEY is not set. Add it to .env.local (or your DeepSeek API key in User Settings) to use DeepSeek in AI Chat."
            : "ANTHROPIC_API_KEY is not set. Add it to .env.local to use Claude in AI Chat.";
    return NextResponse.json({ error: hint }, { status: 503 });
  }
  const parsed = parseCommitteeChatMessages(b.messages);
  if (!Array.isArray(parsed)) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const sym = sanitizeTicker(b.ticker);
  const includeOreo = b.includeOreoContext !== false;

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

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = resolveCommitteeChatModels(b);

  const result = await llmCompleteConversation(provider, system, parsed, {
    maxTokens: 4096,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: apiKeysForCall,
    claudeTools:
      provider === "claude" && isClaudeWebSearchToolEnabled() ? [WEB_SEARCH_TOOL] : undefined,
    openaiWebSearch: provider === "openai" && isOpenAiWebSearchEnabled(),
    geminiGoogleSearch: provider === "gemini" && isGeminiGoogleSearchEnabled(),
  });

  if (!result.ok) {
    const status =
      result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const label =
      provider === "openai"
        ? "OpenAI"
        : provider === "gemini"
          ? "Gemini"
          : provider === "deepseek"
            ? "DeepSeek"
            : "Claude";
    const short =
      result.error.length > 500 ? `${label} request failed` : result.error;
    return NextResponse.json({ error: short }, { status: status === 400 ? 400 : status });
  }

  return NextResponse.json({ ok: true, text: result.text });
}
