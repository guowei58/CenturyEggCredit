/**
 * Shared AI backend selection (Anthropic Claude, OpenAI ChatGPT API, Google Gemini, DeepSeek API).
 */

export type AiProvider = "claude" | "openai" | "gemini" | "deepseek";

/** Selected provider chip (Covenants, AI Chat): Claude green, ChatGPT red, DeepSeek blue, Gemini yellow. */
export const AI_PROVIDER_CHIP_SELECTED: Record<AiProvider, { background: string; color: string }> = {
  claude: { background: "#16a34a", color: "#ffffff" },
  openai: { background: "#dc2626", color: "#ffffff" },
  gemini: { background: "#EAB308", color: "#0a0a0a" },
  deepseek: { background: "#2563eb", color: "#ffffff" },
};

export function aiProviderChipStyle(active: AiProvider, chip: AiProvider): { background: string; color: string } {
  if (active !== chip) return { background: "transparent", color: "var(--muted2)" };
  return AI_PROVIDER_CHIP_SELECTED[chip];
}

/** Stable id for `UserPreferences.feedCaches` / legacy cleanup (provider is stored in prefs). */
export const AI_PROVIDER_STORAGE_KEY = "oreo-ai-provider";

export function normalizeAiProvider(raw: unknown): AiProvider | null {
  if (raw === "ollama") return "deepseek";
  if (raw === "claude" || raw === "openai" || raw === "gemini" || raw === "deepseek") return raw;
  return null;
}

export function defaultServerProvider(): AiProvider {
  const env = process.env.AI_DEFAULT_PROVIDER?.trim().toLowerCase();
  if ((env === "deepseek" || env === "ollama") && process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  if (env === "gemini" && process.env.GEMINI_API_KEY?.trim()) return "gemini";
  if (env === "openai" && process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (env === "claude" && process.env.ANTHROPIC_API_KEY?.trim()) return "claude";
  if (process.env.ANTHROPIC_API_KEY?.trim()) return "claude";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  return "claude";
}

export function resolveProvider(requested: unknown): AiProvider {
  const n = normalizeAiProvider(requested);
  if (n) return n;
  return defaultServerProvider();
}
