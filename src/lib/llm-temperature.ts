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
