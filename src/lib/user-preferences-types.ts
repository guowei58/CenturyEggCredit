import type { AiProvider } from "@/lib/ai-provider";

export const USER_PREFERENCES_VERSION = 1 as const;

/** Max serialized JSON length for `user_preferences.payload` (one string per account). */
export const MAX_PREFS_CHARS = 5_000_000;

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
  /** Ticker (uppercase) → draft JSON (UI fields + project shell; ingested text is not stored here—see credit memo workspace until a work product completes). */
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

/** Approximate JSON footprint of each top-level field (for debugging size limits). */
export type PreferencesPayloadSizeAnalysis = {
  totalChars: number;
  topLevel: { key: string; chars: number }[];
  feedCacheEntries: { key: string; chars: number }[];
  memoDraftEntries: { ticker: string; chars: number }[];
  /** Raw string length of non-empty API key fields (not JSON overhead). */
  apiKeyStringsChars: number;
};

export function analyzePreferencesPayloadSize(data: UserPreferencesData): PreferencesPayloadSizeAnalysis {
  const totalChars = JSON.stringify(data).length;
  const topLevel: { key: string; chars: number }[] = [];
  for (const key of Object.keys(data) as (keyof UserPreferencesData)[]) {
    topLevel.push({ key: String(key), chars: JSON.stringify({ [key]: data[key] }).length });
  }
  topLevel.sort((a, b) => b.chars - a.chars);

  const feedCacheEntries =
    data.feedCaches && typeof data.feedCaches === "object"
      ? Object.entries(data.feedCaches)
          .map(([k, v]) => ({ key: k, chars: JSON.stringify(v).length }))
          .sort((a, b) => b.chars - a.chars)
      : [];

  const memoDraftEntries =
    data.creditMemoDrafts && typeof data.creditMemoDrafts === "object"
      ? Object.entries(data.creditMemoDrafts)
          .map(([k, v]) => ({ ticker: k, chars: JSON.stringify(v).length }))
          .sort((a, b) => b.chars - a.chars)
      : [];

  let apiKeyStringsChars = 0;
  const uk = data.userLlmApiKeys;
  if (uk && typeof uk === "object") {
    for (const v of Object.values(uk)) {
      if (typeof v === "string" && v.length > 0) apiKeyStringsChars += v.length;
    }
  }

  return {
    totalChars,
    topLevel,
    feedCacheEntries,
    memoDraftEntries,
    apiKeyStringsChars,
  };
}

/** User-facing explanation when the serialized blob exceeds `MAX_PREFS_CHARS`. */
export function formatPreferencesOversizeMessage(
  data: UserPreferencesData,
  maxChars: number = MAX_PREFS_CHARS
): string {
  const a = analyzePreferencesPayloadSize(data);
  const parts: string[] = [];
  parts.push(
    `This save would be ${a.totalChars.toLocaleString()} characters (max ${maxChars.toLocaleString()}). The cap applies to your entire saved preferences JSON, not only API keys.`
  );
  parts.push(
    `Your API key strings add up to about ${a.apiKeyStringsChars.toLocaleString()} characters—so if you are over the limit, the bulk is almost certainly cached feeds, memo drafts, or long prompt templates.`
  );
  const bigSections = a.topLevel
    .filter((x) => x.key !== "v" && x.chars > 500)
    .slice(0, 5)
    .map((x) => `${x.key} ~${x.chars.toLocaleString()}`)
    .join(", ");
  if (bigSections) parts.push(`Largest top-level sections: ${bigSections}.`);
  const topFeed = a.feedCacheEntries[0];
  if (topFeed && topFeed.chars > 10_000) {
    const fc = a.feedCacheEntries
      .slice(0, 3)
      .map((e) => `${e.key} ~${e.chars.toLocaleString()}`)
      .join("; ");
    parts.push(`Largest feed cache entries: ${fc}.`);
  }
  const topMemo = a.memoDraftEntries[0];
  if (topMemo && topMemo.chars > 10_000) {
    const md = a.memoDraftEntries
      .slice(0, 3)
      .map((e) => `${e.ticker} ~${e.chars.toLocaleString()}`)
      .join("; ");
    parts.push(`Largest memo drafts: ${md}.`);
  }
  parts.push("Clear or trim those areas if you need room.");
  return parts.join(" ");
}

export function isPrefsEffectivelyEmpty(data: UserPreferencesData): boolean {
  const keys = Object.keys(data).filter((k) => k !== "v" && k !== "migratedFromLocalStorage");
  return keys.length === 0;
}
