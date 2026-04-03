import type { AiProvider } from "@/lib/ai-provider";

export const USER_PREFERENCES_VERSION = 1 as const;

/** Signed-in UI state persisted in Postgres (`/api/me/preferences`). */
export type UserPreferencesData = {
  v: typeof USER_PREFERENCES_VERSION;
  /** Set after first-load migration bookkeeping (browser import disabled). */
  migratedFromLocalStorage?: boolean;
  aiProvider?: AiProvider;
  aiModels?: Partial<Record<AiProvider, string>>;
  /** Tab id → custom prompt template text */
  promptTemplates?: Record<string, string>;
  /** Opaque cache blobs (e.g. feed JSON), arbitrary string keys */
  feedCaches?: Record<string, string>;
  /** Ticker (uppercase) → IR indexer hints */
  irIndexer?: Record<
    string,
    { lastSourceId?: string; suggestedIrUrl?: string; suggestedIrMeta?: string }
  >;
  /** Ticker (uppercase) → JSON string of credit memo draft */
  creditMemoDrafts?: Record<string, string>;
  includeOreoContext?: boolean;
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
