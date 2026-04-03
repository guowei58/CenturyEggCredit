"use client";

import { SessionProvider } from "next-auth/react";
import { UserPreferencesProvider } from "@/components/UserPreferencesProvider";

export function AuthSessionProvider({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <UserPreferencesProvider>{children}</UserPreferencesProvider>
    </SessionProvider>
  );
}
