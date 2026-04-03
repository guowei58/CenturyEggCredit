import { NextResponse } from "next/server";
import { resolveProvider } from "@/lib/ai-provider";
import { discoverPresentations } from "@/lib/presentations-discovery";
import { isProviderConfigured } from "@/lib/llm-router";
import { checkOllamaHealth } from "@/lib/ollama";
import { resolvePresentationLlmModels } from "@/lib/ai-model-from-request";

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const cache = new Map<string, { text: string; expires: number }>();

/**
 * GET /api/presentations/[ticker]?refresh=1&provider=claude|openai|gemini|ollama&model=<api-model-id>
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: rawTicker } = await params;
  const ticker = (rawTicker ?? "").trim().toUpperCase();
  if (!ticker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const provider = resolveProvider(searchParams.get("provider"));

  if (!isProviderConfigured(provider)) {
    const msg =
      provider === "openai"
        ? "Presentations via OpenAI require OPENAI_API_KEY in .env.local."
        : provider === "gemini"
          ? "Presentations via Gemini require GEMINI_API_KEY in .env.local."
          : "Presentations via Claude require ANTHROPIC_API_KEY in .env.local.";
    return NextResponse.json({ ok: false, error: msg }, { status: 503 });
  }
  if (provider === "ollama") {
    const h = await checkOllamaHealth();
    if (h.status === "disconnected") {
      return NextResponse.json(
        { ok: false, error: "Ollama not reachable. Run `ollama serve`." },
        { status: 503 }
      );
    }
    if (h.status === "model_missing") {
      return NextResponse.json(
        { ok: false, error: `Ollama model missing. Run: ollama pull ${h.model}` },
        { status: 503 }
      );
    }
    if (h.status === "error") {
      return NextResponse.json({ ok: false, error: h.detail ?? "Ollama check failed." }, { status: 503 });
    }
  }

  const presentationModels = resolvePresentationLlmModels(provider, searchParams.get("model"));

  const refresh = searchParams.get("refresh") === "1";
  const modelFingerprint =
    provider === "claude"
      ? presentationModels.claudeModel
      : provider === "openai"
        ? presentationModels.openaiModel ?? ""
        : provider === "gemini"
          ? presentationModels.geminiModel ?? ""
          : presentationModels.ollamaModel ?? "";
  const cacheKey = `${ticker}:${provider}:${modelFingerprint}`;

  if (!refresh) {
    const entry = cache.get(cacheKey);
    if (entry && Date.now() < entry.expires) {
      return NextResponse.json({ ok: true, text: entry.text, provider });
    }
  }

  const result = await discoverPresentations(ticker, provider, presentationModels);
  if (!result.ok) {
    const message =
      result.status === 401
        ? provider === "openai"
          ? "Invalid OpenAI API key. Check OPENAI_API_KEY in .env.local."
          : provider === "gemini"
            ? "Invalid Gemini API key. Check GEMINI_API_KEY in .env.local."
            : provider === "ollama"
              ? "Ollama rejected the request. Check the model name and `ollama serve`."
              : "Invalid API key. Check ANTHROPIC_API_KEY in .env.local and restart the server."
        : result.status === 429
          ? "Too many requests. Try again in a moment."
          : result.error?.includes("model") || result.error?.includes("not found")
            ? provider === "openai"
              ? "The configured OpenAI model may be unavailable. Try OPENAI_PRESENTATIONS_MODEL or OPENAI_MODEL in .env.local."
              : provider === "gemini"
                ? "The configured Gemini model may be unavailable. Try GEMINI_PRESENTATIONS_MODEL or GEMINI_MODEL in .env.local."
                : provider === "ollama"
                  ? "Ollama model issue. Run `ollama pull` for your OLLAMA_MODEL or set OLLAMA_PRESENTATIONS_MODEL."
                  : "The configured model is not available. Try setting ANTHROPIC_PRESENTATIONS_MODEL in .env.local."
            : "Could not load presentations right now.";
    return NextResponse.json(
      { ok: false, error: message },
      { status: result.status === 401 ? 401 : 502 }
    );
  }

  cache.set(cacheKey, { text: result.text, expires: Date.now() + CACHE_TTL_MS });
  return NextResponse.json({ ok: true, text: result.text, provider });
}
