"use client";

import type { AiProvider } from "@/lib/ai-provider";
import { AI_MODEL_STORAGE_KEYS, sanitizeClientModelId } from "@/lib/ai-model-options";
import { getSyncUserPreferences } from "@/lib/user-preferences-sync-cache";

/** Model id from user preferences for this provider (same value sent as `*Model` overrides on memo/deck APIs). */
export function resolvedUserModelIdForProvider(p: AiProvider): string | undefined {
  try {
    const models = getSyncUserPreferences()?.aiModels as
      | Partial<Record<AiProvider | "ollama", string>>
      | undefined;
    const raw =
      p === "deepseek"
        ? models?.deepseek ?? models?.ollama
        : models?.[p];
    return sanitizeClientModelId(typeof raw === "string" ? raw : "");
  } catch {
    return undefined;
  }
}

/** Fields accepted by server routes for per-request model overrides. */
export function modelOverridePayloadForProvider(p: AiProvider): {
  claudeModel?: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel?: string;
} {
  const id = resolvedUserModelIdForProvider(p);
  if (!id) return {};
  if (p === "claude") return { claudeModel: id };
  if (p === "openai") return { openaiModel: id };
  if (p === "gemini") return { geminiModel: id };
  return { deepseekModel: id };
}

/** Map provider → stable preference field key (matches `AI_MODEL_STORAGE_KEYS`). */
export function aiModelPreferenceKeyForProvider(p: AiProvider): string {
  return AI_MODEL_STORAGE_KEYS[p];
}

/** `"__saved__"` uses the model id from User Settings (same as toolbar defaults); otherwise a concrete model id for this run only. */
export type ModelRunChoice = "__saved__" | string;

export function modelPayloadForRun(
  provider: AiProvider,
  choice: ModelRunChoice
): {
  claudeModel?: string;
  openaiModel?: string;
  geminiModel?: string;
  deepseekModel?: string;
} {
  if (choice === "__saved__") return modelOverridePayloadForProvider(provider);
  const id = sanitizeClientModelId(choice);
  if (!id) return modelOverridePayloadForProvider(provider);
  if (provider === "claude") return { claudeModel: id };
  if (provider === "openai") return { openaiModel: id };
  if (provider === "gemini") return { geminiModel: id };
  return { deepseekModel: id };
}
