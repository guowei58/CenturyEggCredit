import type { AiProvider } from "@/lib/ai-provider";
import type { UserPreferencesData } from "@/lib/user-preferences-types";

/** 0 = Engineer (rigorous), 100 = Artist (creative). */
export const LLM_CREATIVITY_MIN = 0;
export const LLM_CREATIVITY_MAX = 100;
export const DEFAULT_LLM_CREATIVITY = 20;

export function clampLlmCreativity(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_LLM_CREATIVITY;
  return Math.min(LLM_CREATIVITY_MAX, Math.max(LLM_CREATIVITY_MIN, Math.round(raw)));
}

/** Maps creativity slider to provider `temperature` (0.15 = evidence-focused … 1.0 = exploratory). */
export function llmTemperatureFromCreativity(creativity: number): number {
  const t = clampLlmCreativity(creativity) / LLM_CREATIVITY_MAX;
  return Math.round((0.15 + t * 0.85) * 100) / 100;
}

export function resolveLlmTemperatureFromPrefs(
  prefs: Pick<UserPreferencesData, "llmCreativity">
): number {
  return llmTemperatureFromCreativity(prefs.llmCreativity ?? DEFAULT_LLM_CREATIVITY);
}

/** Attach OpenAI-style `temperature` when set (Claude, OpenAI, DeepSeek, Gemini OpenAI-compat). */
export function applyChatCompletionsTemperature(body: Record<string, unknown>, temperature?: number): void {
  if (temperature == null || !Number.isFinite(temperature)) return;
  body.temperature = Math.min(2, Math.max(0, temperature));
}

function normalizeModelId(model: string): string {
  return model.trim().toLowerCase().replace(/^models\//, "");
}

/**
 * Whether the provider/model pair accepts a sampling `temperature` (Engineer ↔ Artist slider).
 * When false, callers must omit temperature — sending it causes hard API errors on some models.
 */
export function modelAcceptsTemperature(provider: AiProvider, model: string): boolean {
  const m = normalizeModelId(model);
  if (!m) return true;

  switch (provider) {
    case "openai":
      if (m.startsWith("gpt-5")) return false;
      if (m.includes("search")) return false;
      if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return false;
      return true;
    case "deepseek":
      if (m.includes("reasoner")) return false;
      return true;
    case "claude":
      return true;
    case "gemini":
      if (m.includes("thinking")) return false;
      if (m.includes("-exp") || m.endsWith("-exp")) return false;
      return true;
    default:
      return true;
  }
}

/** Chat Completions / Messages JSON bodies — skips temperature when the model rejects it. */
export function applyProviderChatTemperature(
  provider: AiProvider,
  model: string,
  body: Record<string, unknown>,
  temperature?: number
): void {
  if (modelAcceptsTemperature(provider, model)) {
    applyChatCompletionsTemperature(body, temperature);
  }
}

/** Gemini native `generateContent` `generationConfig` temperature field (omit when unsupported). */
export function geminiNativeTemperatureField(
  model: string,
  temperature?: number
): { temperature?: number } {
  if (!modelAcceptsTemperature("gemini", model)) return {};
  if (temperature == null || !Number.isFinite(temperature)) return {};
  return { temperature: Math.min(2, Math.max(0, temperature)) };
}

export function llmCreativityStyleHint(creativity: number): string {
  const c = clampLlmCreativity(creativity);
  if (c <= 15) {
    return "Engineer — favor evidence, citations, and explicit uncertainty when facts are missing.";
  }
  if (c >= 85) {
    return "Artist — more exploratory framing and creative connections; still avoid inventing facts.";
  }
  if (c < 50) {
    return "Leaning engineer — structured, proof-oriented answers.";
  }
  return "Balanced — mix rigor with readable synthesis.";
}
