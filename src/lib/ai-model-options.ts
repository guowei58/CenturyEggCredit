/**
 * Shared AI model id presets and validation (client + server).
 * Exact availability depends on your API keys and provider dashboards.
 */

import type { AiProvider } from "@/lib/ai-provider";

const MAX_MODEL_LEN = 120;
/** Conservative: provider model ids are alphanumeric plus common separators. */
const MODEL_ID_RE = /^[a-zA-Z0-9._\-:]+$/;

export function sanitizeClientModelId(raw: unknown): string | undefined {
  if (raw == null) return undefined;
  const s = String(raw).trim();
  if (!s || s.length > MAX_MODEL_LEN) return undefined;
  if (!MODEL_ID_RE.test(s)) return undefined;
  return s;
}

/** Stable key ids for `UserPreferences.aiModels` (one model id per provider). */
export const AI_MODEL_STORAGE_KEYS: Record<AiProvider, string> = {
  claude: "oreo-ai-model-claude",
  openai: "oreo-ai-model-openai",
  gemini: "oreo-ai-model-gemini",
  deepseek: "oreo-ai-model-deepseek",
};

export type ModelPreset = { id: string; label: string };

/** Roughly highest → lowest typical API cost (Opus → Sonnet → Haiku). Matches `anthropic.ts` default on last id. */
export const CLAUDE_MODEL_PRESETS: ModelPreset[] = [
  { id: "claude-opus-4-6", label: "Claude Opus 4.6 — priciest" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — app default" },
  { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet" },
  { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku" },
  { id: "claude-3-opus-20240229", label: "Claude 3 Opus" },
];

/** Roughly highest → lowest typical API cost (reasoning / flagship → mini). */
export const OPENAI_MODEL_PRESETS: ModelPreset[] = [
  { id: "gpt-5.4", label: "GPT-5.4 (Thinking) — priciest" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
  { id: "gpt-4o-mini", label: "GPT-4o mini — app default" },
];

/** Roughly highest → lowest typical API cost (Pro → Flash → Flash Lite). Matches `gemini.ts` default on last id. */
export const GEMINI_MODEL_PRESETS: ModelPreset[] = [
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro — priciest" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — app default" },
];

export const DEEPSEEK_MODEL_PRESETS: ModelPreset[] = [
  { id: "deepseek-chat", label: "DeepSeek Chat — app default" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
];

export function presetsForProvider(p: AiProvider): ModelPreset[] {
  if (p === "claude") return CLAUDE_MODEL_PRESETS;
  if (p === "openai") return OPENAI_MODEL_PRESETS;
  if (p === "gemini") return GEMINI_MODEL_PRESETS;
  if (p === "deepseek") return DEEPSEEK_MODEL_PRESETS;
  return [];
}

/** Human label from presets when the id matches; otherwise null (caller shows raw id). */
export function presetLabelForModelId(provider: AiProvider, modelId: string): string | null {
  const hit = presetsForProvider(provider).find((p) => p.id === modelId);
  return hit?.label ?? null;
}

/** Short UI name, e.g. "Claude Opus 4.6" (drops trailing " — priciest" from preset labels). */
export function shortModelDisplayName(provider: AiProvider, modelId: string): string {
  const label = presetLabelForModelId(provider, modelId);
  if (label) {
    const main = label.split(" — ")[0]?.trim();
    return main || label;
  }
  return modelId;
}
