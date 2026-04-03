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
  ollama: "oreo-ai-model-ollama",
};

export type ModelPreset = { id: string; label: string };

export const CLAUDE_MODEL_PRESETS: ModelPreset[] = [
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
];

export const OPENAI_MODEL_PRESETS: ModelPreset[] = [
  { id: "gpt-4o-mini", label: "GPT-4o mini" },
  { id: "gpt-4o", label: "GPT-4o" },
  { id: "gpt-4-turbo", label: "GPT-4 Turbo" },
];

export const GEMINI_MODEL_PRESETS: ModelPreset[] = [
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
];

export function presetsForProvider(p: AiProvider): ModelPreset[] {
  if (p === "claude") return CLAUDE_MODEL_PRESETS;
  if (p === "openai") return OPENAI_MODEL_PRESETS;
  if (p === "gemini") return GEMINI_MODEL_PRESETS;
  return [];
}
