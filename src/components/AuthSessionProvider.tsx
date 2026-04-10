"use client";

import { SessionProvider } from "next-auth/react";
import { UserPreferencesProvider } from "@/components/UserPreferencesProvider";
import { UserSettingsModalProvider } from "@/components/layout/UserSettingsModalProvider";

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UserPreferencesProvider>
        <UserSettingsModalProvider>{children}</UserSettingsModalProvider>
      </UserPreferencesProvider>
    </SessionProvider>
  );
}
