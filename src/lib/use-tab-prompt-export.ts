"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Keeps Open-in-AI clipboard text in sync with PromptTemplateBox preview (including unsaved edits).
 */
export function useTabPromptExport(fallback: () => string) {
  const latestResolvedRef = useRef<string | null>(null);
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);

  const onResolvedPromptChange = useCallback((resolved: string, editing = false) => {
    latestResolvedRef.current = resolved;
    setIsEditingPrompt(editing);
  }, []);

  const getPromptForExport = useCallback(() => {
    const fromPreview = latestResolvedRef.current?.trim();
    if (fromPreview) return fromPreview;
    return fallback();
  }, [fallback]);

  return { onResolvedPromptChange, getPromptForExport, isEditingPrompt };
}
