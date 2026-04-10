"use client";

import { useEffect, useMemo, useState } from "react";
import type { AiProvider } from "@/lib/ai-provider";
import { presetsForProvider, sanitizeClientModelId } from "@/lib/ai-model-options";
import type { ModelRunChoice } from "@/lib/ai-model-prefs-client";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

const CUSTOM = "__custom__";
const SAVED = "__saved__";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
  deepseek: "DeepSeek",
};

type Props = {
  open: boolean;
  provider: AiProvider | null;
  title?: string;
  confirmLabel?: string;
  onCancel: () => void;
  onConfirm: (choice: ModelRunChoice) => void;
};

/**
 * Asks which model to use for a one-shot API run (tab prompt buttons, bulk API bar, etc.).
 */
export function ApiModelChoiceModal({
  open,
  provider,
  title,
  confirmLabel = "Run",
  onCancel,
  onConfirm,
}: Props) {
  const { ready, preferences } = useUserPreferences();
  const [selectValue, setSelectValue] = useState<string>(SAVED);
  const [custom, setCustom] = useState("");

  const presets = provider ? presetsForProvider(provider) : [];

  const savedLine = useMemo(() => {
    if (!provider) return "";
    const models = preferences.aiModels as Partial<Record<AiProvider | "ollama", string>> | undefined;
    const raw =
      provider === "deepseek" ? models?.deepseek ?? models?.ollama : models?.[provider];
    const id = sanitizeClientModelId(typeof raw === "string" ? raw : "") ?? "";
    if (!id) return "none — server / env default";
    const hit = presets.find((p) => p.id === id);
    return hit ? hit.label : id;
  }, [provider, preferences.aiModels, presets]);

  useEffect(() => {
    if (!open || !provider) return;
    setSelectValue(SAVED);
    setCustom("");
  }, [open, provider, preferences.aiModels]);

  if (!open || !provider) return null;

  function confirmCloud() {
    if (selectValue === SAVED) {
      onConfirm("__saved__");
      return;
    }
    if (selectValue === CUSTOM) {
      const id = sanitizeClientModelId(custom);
      if (!id) {
        onConfirm("__saved__");
        return;
      }
      onConfirm(id);
      return;
    }
    onConfirm(selectValue);
  }

  return (
    <div
      className="fixed inset-0 z-[410] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Choose API model"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-xl border shadow-xl"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
          <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title ?? `Which ${PROVIDER_LABEL[provider]} model?`}
          </h3>
          <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
            Choose a model for this run. &quot;Saved preference&quot; uses the model from User Settings (same as the AI toolbar).
          </p>
        </div>
        <div className="p-4">
          <label className="block text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
            Model
          </label>
          <select
            value={selectValue === CUSTOM ? CUSTOM : selectValue}
            disabled={!ready}
            onChange={(e) => {
              const v = e.target.value;
              setSelectValue(v);
              if (v !== CUSTOM) setCustom("");
            }}
            className="mt-2 w-full rounded border px-2 py-2 text-xs"
            style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
            aria-label="Model preset"
          >
            <option value={SAVED}>Saved preference ({savedLine})</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
            <option value={CUSTOM}>Custom model id…</option>
          </select>
          {selectValue === CUSTOM ? (
            <input
              type="text"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              disabled={!ready}
              placeholder="Any model id your API accepts"
              className="mt-2 w-full rounded border px-2 py-2 font-mono text-xs"
              style={{ borderColor: "var(--border2)", background: "var(--card)", color: "var(--text)" }}
              spellCheck={false}
              aria-label="Custom model id"
            />
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border2)" }}>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            onClick={() => confirmCloud()}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
