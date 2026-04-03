import { getSyncUserPreferences } from "@/lib/user-preferences-sync-cache";

export const PROMPT_TEMPLATE_OVERRIDE_PREFIX = "century-egg-prompt-template-override:";

export function promptTemplateOverrideStorageKey(tabId: string): string {
  return `${PROMPT_TEMPLATE_OVERRIDE_PREFIX}${tabId}`;
}

/**
 * Current override for a tab (from synced user preferences — same source as {@link usePromptTemplateOverride}).
 */
export function readPromptTemplateOverride(tabId: string, defaultTemplate: string): string {
  try {
    const s = getSyncUserPreferences()?.promptTemplates?.[tabId];
    if (typeof s === "string" && s.trim().length > 0) return s;
  } catch {
    /* ignore */
  }
  return defaultTemplate;
}
