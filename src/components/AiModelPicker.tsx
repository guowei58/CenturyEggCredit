"use client";

import { useCallback, useEffect, useState } from "react";
import type { AiProvider } from "@/lib/ai-provider";
import { presetsForProvider, sanitizeClientModelId } from "@/lib/ai-model-options";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

const CUSTOM = "__custom__";

/**
 * Per-provider API model id (stored in user preferences on server).
 */
export function AiModelPicker({
  provider,
  className = "",
}: {
  provider: AiProvider;
  className?: string;
}) {
  const { ready, preferences, updatePreferences } = useUserPreferences();
  const [selectValue, setSelectValue] = useState<string>("");
  const [custom, setCustom] = useState("");

  const persist = useCallback(
    (stored: string) => {
      const t = stored.trim();
      const ok = sanitizeClientModelId(t);
      updatePreferences((p) => {
        const nextModels = { ...(p.aiModels ?? {}) };
        if (!ok) delete nextModels[provider];
        else nextModels[provider] = ok;
        return {
          ...p,
          aiModels: Object.keys(nextModels).length ? nextModels : undefined,
        };
      });
    },
    [provider, updatePreferences]
  );

  const hydrate = useCallback(() => {
    if (!ready) return;
    const presets = presetsForProvider(provider);
    const models = preferences.aiModels as Partial<Record<AiProvider | "ollama", string>> | undefined;
    const raw =
      provider === "deepseek" ? models?.deepseek ?? models?.ollama : models?.[provider];
    const id = sanitizeClientModelId(typeof raw === "string" ? raw : "") ?? "";

    if (!id) {
      setSelectValue("");
      setCustom("");
      return;
    }
    if (presets.some((p) => p.id === id)) {
      setSelectValue(id);
      setCustom("");
    } else {
      setSelectValue(CUSTOM);
      setCustom(id);
    }
  }, [ready, preferences, provider]);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  const presets = presetsForProvider(provider);

  return (
    <div className={`flex flex-col gap-1.5 sm:flex-row sm:flex-wrap sm:items-center ${className}`}>
      <span className="text-[10px] font-medium uppercase tracking-wide sm:mr-1" style={{ color: "var(--muted2)" }}>
        API model
      </span>
      <select
        value={selectValue === CUSTOM ? CUSTOM : selectValue}
        disabled={!ready}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "" || v === "default") {
            setSelectValue("");
            setCustom("");
            persist("");
            return;
          }
          if (v === CUSTOM) {
            setSelectValue(CUSTOM);
            const ok = sanitizeClientModelId(custom);
            persist(ok ?? "");
            return;
          }
          setSelectValue(v);
          setCustom("");
          persist(v);
        }}
        className="max-w-[min(100%,280px)] rounded border px-2 py-1 text-[11px]"
        style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
        aria-label="API model preset"
      >
        <option value="">Default (.env)</option>
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value={CUSTOM}>Custom id…</option>
      </select>
      {(selectValue === CUSTOM || (selectValue === "" && custom)) && (
        <input
          type="text"
          value={custom}
          onChange={(e) => {
            setSelectValue(CUSTOM);
            setCustom(e.target.value);
          }}
          onBlur={() => {
            const ok = sanitizeClientModelId(custom);
            persist(ok ?? "");
          }}
          disabled={!ready}
          placeholder="Any model id your API accepts"
          className="min-w-[180px] max-w-[min(100%,320px)] rounded border px-2 py-1 font-mono text-[11px]"
          style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
          spellCheck={false}
          aria-label="Custom API model id"
        />
      )}
    </div>
  );
}
