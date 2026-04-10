"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useSession } from "next-auth/react";
import { emailUsesHostedLlmKeys } from "@/lib/hosted-llm-accounts";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { UserSettingsModal } from "@/components/layout/UserSettingsModal";

export type UserSettingsFocus = "general" | "api-keys";

type Ctx = {
  openSettings: (opts?: { focus?: UserSettingsFocus }) => void;
  closeSettings: () => void;
};

const UserSettingsModalContext = createContext<Ctx | null>(null);

export function UserSettingsModalProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState<UserSettingsFocus>("general");
  const { data: session, status } = useSession();
  const { ready, preferences, updatePreferences } = useUserPreferences();
  const email = session?.user?.email ?? null;
  const isHosted = emailUsesHostedLlmKeys(email);

  useEffect(() => {
    if (status !== "authenticated" || !ready) return;
    if (isHosted) return;
    if (preferences.apiKeysSetupPending) {
      setFocus("api-keys");
      setOpen(true);
    }
  }, [status, ready, isHosted, preferences.apiKeysSetupPending]);

  const openSettings = useCallback((opts?: { focus?: UserSettingsFocus }) => {
    setFocus(opts?.focus ?? "general");
    setOpen(true);
  }, []);

  const closeSettings = useCallback(() => {
    setOpen(false);
  }, []);

  const onCloseModal = useCallback(() => {
    setOpen(false);
    if (!isHosted && preferences.apiKeysSetupPending) {
      updatePreferences((p) => ({ ...p, apiKeysSetupPending: false }));
    }
  }, [isHosted, preferences.apiKeysSetupPending, updatePreferences]);

  const value = useMemo(() => ({ openSettings, closeSettings }), [openSettings, closeSettings]);

  return (
    <UserSettingsModalContext.Provider value={value}>
      {children}
      <UserSettingsModal
        open={open}
        onClose={onCloseModal}
        initialFocus={focus}
        hostedLlmAccount={isHosted}
      />
    </UserSettingsModalContext.Provider>
  );
}

export function useUserSettingsModal(): Ctx {
  const ctx = useContext(UserSettingsModalContext);
  if (!ctx) {
    throw new Error("useUserSettingsModal must be used within UserSettingsModalProvider");
  }
  return ctx;
}

export function useUserSettingsModalOptional(): Ctx | null {
  return useContext(UserSettingsModalContext);
}
