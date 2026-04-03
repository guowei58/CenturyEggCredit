import type { UserPreferencesData } from "@/lib/user-preferences-types";

/** Synchronous read for fetch bodies (e.g. model overrides) while React state may lag one tick. */
let syncPrefs: UserPreferencesData | null = null;

export function setSyncUserPreferences(p: UserPreferencesData | null): void {
  syncPrefs = p;
}

export function getSyncUserPreferences(): UserPreferencesData | null {
  return syncPrefs;
}
