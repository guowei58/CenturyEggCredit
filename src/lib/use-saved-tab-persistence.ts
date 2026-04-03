"use client";

import { useMemo } from "react";

/** Login is required app-wide; saved tab text is always loaded from the server only. */
export function mergeSavedTabContent(fromServer: string | null): string {
  return fromServer ?? "";
}

export function useSavedTabPersistence(): {
  merge: (fromServer: string | null) => string;
} {
  return useMemo(
    () => ({
      merge: mergeSavedTabContent,
    }),
    []
  );
}
