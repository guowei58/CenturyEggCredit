"use client";

import { useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

/**
 * Per-tab prompt template override (stored in Postgres via user preferences).
 */
export function usePromptTemplateOverride(tabId: string, defaultTemplate: string) {
  const { ready, preferences, updatePreferences } = useUserPreferences();
  const [template, setTemplateState] = useState<string>(defaultTemplate);

  useEffect(() => {
    if (!ready) return;
    const fromServer = preferences.promptTemplates?.[tabId];
    if (typeof fromServer === "string" && fromServer.trim().length > 0) {
      setTemplateState(fromServer);
    } else {
      setTemplateState(defaultTemplate);
    }
  }, [ready, preferences, tabId, defaultTemplate]);

  const isOverridden = useMemo(() => {
    const cur = template.trim();
    const def = defaultTemplate.trim();
    return cur.length > 0 && cur !== def;
  }, [template, defaultTemplate]);

  function setTemplate(next: string) {
    setTemplateState(next);
    updatePreferences((p) => {
      const pt = { ...(p.promptTemplates ?? {}), [tabId]: next };
      return { ...p, promptTemplates: pt };
    });
  }

  function resetToDefault() {
    setTemplateState(defaultTemplate);
    updatePreferences((p) => {
      const pt = { ...(p.promptTemplates ?? {}) };
      delete pt[tabId];
      return {
        ...p,
        promptTemplates: Object.keys(pt).length ? pt : undefined,
      };
    });
  }

  return { template, setTemplate, resetToDefault, isOverridden };
}
