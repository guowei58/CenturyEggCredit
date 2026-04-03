"use client";

import type { AiProvider } from "@/lib/ai-provider";
import { AI_MODEL_STORAGE_KEYS, sanitizeClientModelId } from "@/lib/ai-model-options";
import { getSyncUserPreferences } from "@/lib/user-preferences-sync-cache";

/** Fields accepted by server routes for per-request model overrides. */
export function modelOverridePayloadForProvider(p: AiProvider): {
  claudeModel?: string;
  openaiModel?: string;
  geminiModel?: string;
  ollamaModel?: string;
} {
  try {
    const models = getSyncUserPreferences()?.aiModels;
    const raw = models?.[p] ?? null;
    const id = sanitizeClientModelId(typeof raw === "string" ? raw : "");
    if (!id) return {};
    if (p === "claude") return { claudeModel: id };
    if (p === "openai") return { openaiModel: id };
    if (p === "gemini") return { geminiModel: id };
    return { ollamaModel: id };
  } catch {
    return {};
  }
}

/** Map provider → stable preference field key (matches `AI_MODEL_STORAGE_KEYS`). */
export function aiModelPreferenceKeyForProvider(p: AiProvider): string {
  return AI_MODEL_STORAGE_KEYS[p];
}
