import { auth } from "@/auth";
import { getUserPreferences } from "@/lib/user-preferences-store";
import { buildLlmApiKeyBundle, type LlmCallApiKeys } from "@/lib/user-llm-keys";

export type AuthenticatedLlmContext = {
  userId: string;
  email: string | null;
  bundle: LlmCallApiKeys;
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
  return { ok: true, ctx: { userId, email, bundle } };
}
