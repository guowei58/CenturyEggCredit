/**
 * Browser storage import is intentionally disabled; preferences and tab data are server-backed.
 */

import type { UserPreferencesData } from "@/lib/user-preferences-types";

/** @returns Always empty — use `/api/me/preferences` only. */
export function collectLegacyLocalStoragePrefs(): Partial<UserPreferencesData> {
  return {};
}

/** No-op; kept for call sites that ran cleanup after one-time migration. */
export function clearLegacyPreferenceKeys(): void {}
