/**
 * Resolve which LLM API keys apply for a signed-in user (hosted env keys vs per-user prefs).
 * Server-only helpers; import `emailUsesHostedLlmKeys` from hosted-llm-accounts on the client too.
 */

import { emailUsesHostedLlmKeys } from "@/lib/hosted-llm-accounts";
import type { UserPreferencesData } from "@/lib/user-preferences-types";
import type { AiProvider } from "@/lib/ai-provider";

/** Keys passed into llm-router / low-level clients. No env fallback when this object is supplied. */
export type LlmCallApiKeys = {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  geminiApiKey?: string;
  deepseekApiKey?: string;
};

export { USER_LLM_API_KEYS_POLICY, USER_LLM_KEY_SETTINGS_HINT } from "@/lib/llm-user-key-messages";

export function buildLlmApiKeyBundle(
  email: string | null | undefined,
  prefs: UserPreferencesData
): LlmCallApiKeys {
  if (emailUsesHostedLlmKeys(email)) {
    const u = prefs.userLlmApiKeys ?? {};
    /** Env keys for hosted deploys; User Settings fills gaps so BYOK in Settings still works when .env omits a provider (e.g. DeepSeek). */
    const a = process.env.ANTHROPIC_API_KEY?.trim() || u.anthropicApiKey?.trim();
    const o = process.env.OPENAI_API_KEY?.trim() || u.openaiApiKey?.trim();
    const g = process.env.GEMINI_API_KEY?.trim() || u.geminiApiKey?.trim();
    const d = process.env.DEEPSEEK_API_KEY?.trim() || u.deepseekApiKey?.trim();
    const out: LlmCallApiKeys = {};
    if (a) out.anthropicApiKey = a;
    if (o) out.openaiApiKey = o;
    if (g) out.geminiApiKey = g;
    if (d) out.deepseekApiKey = d;
    return out;
  }
  const u = prefs.userLlmApiKeys ?? {};
  const out: LlmCallApiKeys = {};
  if (u.anthropicApiKey?.trim()) out.anthropicApiKey = u.anthropicApiKey.trim();
  if (u.openaiApiKey?.trim()) out.openaiApiKey = u.openaiApiKey.trim();
  if (u.geminiApiKey?.trim()) out.geminiApiKey = u.geminiApiKey.trim();
  if (u.deepseekApiKey?.trim()) out.deepseekApiKey = u.deepseekApiKey.trim();
  return out;
}

export function isProviderConfiguredForKeys(provider: AiProvider, keys: LlmCallApiKeys): boolean {
  if (provider === "deepseek") return Boolean(keys.deepseekApiKey?.trim());
  if (provider === "openai") return Boolean(keys.openaiApiKey?.trim());
  if (provider === "gemini") return Boolean(keys.geminiApiKey?.trim());
  return Boolean(keys.anthropicApiKey?.trim());
}

/** Per-user keys win; anything missing is filled from `process.env` (logged-in AI Chat, etc.). */
export function mergeLlmCallApiKeysWithProcessEnv(bundle: LlmCallApiKeys): LlmCallApiKeys {
  return {
    anthropicApiKey: bundle.anthropicApiKey?.trim() || process.env.ANTHROPIC_API_KEY?.trim(),
    openaiApiKey: bundle.openaiApiKey?.trim() || process.env.OPENAI_API_KEY?.trim(),
    geminiApiKey: bundle.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim(),
    deepseekApiKey: bundle.deepseekApiKey?.trim() || process.env.DEEPSEEK_API_KEY?.trim(),
  };
}
