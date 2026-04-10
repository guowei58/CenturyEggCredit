import { auth } from "@/auth";
import { responseVerbosityFromPreferences, type ResponseVerbosity } from "@/lib/llm-response-verbosity";
import { getUserPreferences } from "@/lib/user-preferences-store";
import { buildLlmApiKeyBundle, type LlmCallApiKeys } from "@/lib/user-llm-keys";

export type AuthenticatedLlmContext = {
  userId: string;
  email: string | null;
  bundle: LlmCallApiKeys;
  /** User preference: MD (concise) vs Analyst (exhaustive); applied to in-app LLM system prompts. */
  responseVerbosity: ResponseVerbosity;
};

/**
 * Loads preferences and builds the LLM key bundle for the current session.
 * Use in authenticated API routes (middleware already enforces login).
 */
export async function getAuthenticatedLlmContext(): Promise<
  { ok: true; ctx: AuthenticatedLlmContext } | { ok: false; status: 401 }
> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, status: 401 };
  const email = typeof session.user?.email === "string" ? session.user.email : null;
  const prefs = await getUserPreferences(userId);
  const bundle = buildLlmApiKeyBundle(email, prefs);
  const responseVerbosity = responseVerbosityFromPreferences(prefs);
  return { ok: true, ctx: { userId, email, bundle, responseVerbosity } };
}
