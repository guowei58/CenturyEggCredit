/**
 * Client-side check: can this user run cloud LLM API calls for the given provider
 * without opening settings? (Hosted accounts use server env keys.)
 */

import type { AiProvider } from "@/lib/ai-provider";
import { emailUsesHostedLlmKeys } from "@/lib/hosted-llm-accounts";
import type { UserPreferencesData } from "@/lib/user-preferences-types";

export function userHasCloudApiKeyForProvider(
  provider: AiProvider,
  email: string | null | undefined,
  prefs: UserPreferencesData
): boolean {
  if (emailUsesHostedLlmKeys(email)) return true;
  const k = prefs.userLlmApiKeys ?? {};
  if (provider === "claude") return Boolean(k.anthropicApiKey?.trim());
  if (provider === "openai") return Boolean(k.openaiApiKey?.trim());
  if (provider === "gemini") return Boolean(k.geminiApiKey?.trim());
  if (provider === "deepseek") return Boolean(k.deepseekApiKey?.trim());
  return false;
}
