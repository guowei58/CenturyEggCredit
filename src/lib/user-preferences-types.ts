import type { AiProvider } from "@/lib/ai-provider";

export const USER_PREFERENCES_VERSION = 1 as const;

/** Signed-in UI state persisted in Postgres (`/api/me/preferences`). */
export type UserPreferencesData = {
  v: typeof USER_PREFERENCES_VERSION;
  /** Set after first-load migration bookkeeping (browser import disabled). */
  migratedFromLocalStorage?: boolean;
  /**
   * User-editable profile bits.
   * Note: this is *not* the auth identity; it’s UI-level preferences.
   */
  profile?: {
    /** Displayed in Egg-Hoc chat UI + header (does not change auth email/id). */
    chatDisplayId?: string;
    /** Reserved for future fields (timezone, org, etc.). */
  };
  aiProvider?: AiProvider;
  /** Per-provider saved model ids; `ollama` is legacy (maps to DeepSeek). */
  aiModels?: Partial<Record<AiProvider | "ollama", string>>;
  /**
   * Per-user LLM provider keys (stored on the server with your account).
   * Hosted CenturyEggCredit accounts use server .env keys instead; others must fill these to use in-app API buttons.
   */
  userLlmApiKeys?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    geminiApiKey?: string;
    deepseekApiKey?: string;
  };
  /** When true, the app may auto-open settings once to prompt for API keys (non-hosted accounts). */
  apiKeysSetupPending?: boolean;
  /** Tab id → custom prompt template text */
  promptTemplates?: Record<string, string>;
  /** Opaque cache blobs (e.g. feed JSON), arbitrary string keys */
  feedCaches?: Record<string, string>;
  /** Ticker (uppercase) → JSON string of credit memo draft */
  creditMemoDrafts?: Record<string, string>;
  includeOreoContext?: boolean;
  /** When true, Egg-Hoc incoming-message barks are not played. */
  eggHocBarkMuted?: boolean;
};

export function defaultUserPreferences(): UserPreferencesData {
  return { v: USER_PREFERENCES_VERSION };
}

export function parseUserPreferencesPayload(raw: string | null | undefined): UserPreferencesData {
  if (!raw?.trim()) return defaultUserPreferences();
  try {
    const o = JSON.parse(raw) as Partial<UserPreferencesData>;
    if (o?.v !== USER_PREFERENCES_VERSION) return defaultUserPreferences();
    return { ...defaultUserPreferences(), ...o, v: USER_PREFERENCES_VERSION };
  } catch {
    return defaultUserPreferences();
  }
}

export function serializeUserPreferencesPayload(data: UserPreferencesData): string {
  return JSON.stringify(data);
}

export function isPrefsEffectivelyEmpty(data: UserPreferencesData): boolean {
  const keys = Object.keys(data).filter((k) => k !== "v" && k !== "migratedFromLocalStorage");
  return keys.length === 0;
}
