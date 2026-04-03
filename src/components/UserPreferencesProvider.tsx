"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { clearLegacyPreferenceKeys, collectLegacyLocalStoragePrefs } from "@/lib/user-preferences-legacy";
import { mergeLegacyIntoServerPrefs } from "@/lib/user-preferences-merge";
import { setSyncUserPreferences } from "@/lib/user-preferences-sync-cache";
import {
  defaultUserPreferences,
  type UserPreferencesData,
} from "@/lib/user-preferences-types";

function hasLegacyContent(p: Partial<UserPreferencesData>): boolean {
  return Object.keys(p).some((k) => k !== "v");
}

async function pushPreferences(data: UserPreferencesData): Promise<boolean> {
  try {
    const res = await fetch("/api/me/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ preferences: data }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

type UserPreferencesContextValue = {
  ready: boolean;
  preferences: UserPreferencesData;
  updatePreferences: (updater: (prev: UserPreferencesData) => UserPreferencesData) => void;
  /** Replace entire tree (e.g. after structured merge). */
  replacePreferences: (next: UserPreferencesData) => void;
};

const UserPreferencesContext = createContext<UserPreferencesContextValue | null>(null);

export function UserPreferencesProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [ready, setReady] = useState(false);
  const [preferences, setPreferences] = useState<UserPreferencesData>(() => defaultUserPreferences());
  const prefsRef = useRef(preferences);
  prefsRef.current = preferences;

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushSave = useCallback(async (data: UserPreferencesData) => {
    await pushPreferences(data);
  }, []);

  const scheduleSave = useCallback(
    (data: UserPreferencesData) => {
      if (status !== "authenticated") return;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void pushPreferences(data);
      }, 600);
    },
    [status]
  );

  const updatePreferences = useCallback(
    (updater: (prev: UserPreferencesData) => UserPreferencesData) => {
      setPreferences((prev) => {
        const next = updater(prev);
        prefsRef.current = next;
        setSyncUserPreferences(next);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave]
  );

  const replacePreferences = useCallback(
    (next: UserPreferencesData) => {
      prefsRef.current = next;
      setSyncUserPreferences(next);
      setPreferences(next);
      scheduleSave(next);
    },
    [scheduleSave]
  );

  useEffect(() => {
    if (status === "loading") return;
    if (status !== "authenticated") {
      setSyncUserPreferences(null);
      setReady(true);
      return;
    }

    let cancelled = false;
    setReady(false);

    void (async () => {
      try {
        const res = await fetch("/api/me/preferences");
        if (!res.ok) throw new Error("prefs fetch failed");
        const j = (await res.json()) as { preferences?: UserPreferencesData };
        let data = j.preferences ?? defaultUserPreferences();

        if (!data.migratedFromLocalStorage) {
          const legacy = collectLegacyLocalStoragePrefs();
          if (hasLegacyContent(legacy)) {
            data = mergeLegacyIntoServerPrefs(data, legacy);
            await pushPreferences(data);
            clearLegacyPreferenceKeys();
          } else {
            data = { ...data, migratedFromLocalStorage: true };
            await pushPreferences(data);
          }
        }

        if (cancelled) return;
        setPreferences(data);
        prefsRef.current = data;
        setSyncUserPreferences(data);
        setReady(true);
      } catch {
        if (!cancelled) {
          const fallback = defaultUserPreferences();
          setPreferences(fallback);
          setSyncUserPreferences(fallback);
          setReady(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const value = useMemo(
    () => ({ ready, preferences, updatePreferences, replacePreferences }),
    [ready, preferences, updatePreferences, replacePreferences]
  );

  return <UserPreferencesContext.Provider value={value}>{children}</UserPreferencesContext.Provider>;
}

export function useUserPreferences(): UserPreferencesContextValue {
  const ctx = useContext(UserPreferencesContext);
  if (!ctx) {
    throw new Error("useUserPreferences must be used within UserPreferencesProvider");
  }
  return ctx;
}

/** Safe when provider is optional (e.g. tests); returns null outside provider. */
export function useUserPreferencesOptional(): UserPreferencesContextValue | null {
  return useContext(UserPreferencesContext);
}
