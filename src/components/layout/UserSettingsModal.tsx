"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { USER_LLM_API_KEYS_POLICY } from "@/lib/llm-user-key-messages";
import type { UserResponseVerbosity } from "@/lib/user-preferences-types";

const LLM_LINKS = {
  anthropic: "https://console.anthropic.com/settings/keys",
  openai: "https://platform.openai.com/api-keys",
  gemini: "https://aistudio.google.com/apikey",
  deepseek: "https://platform.deepseek.com/api_keys",
} as const;

export function UserSettingsModal({
  open,
  onClose,
  initialFocus = "general",
  hostedLlmAccount = false,
}: {
  open: boolean;
  onClose: () => void;
  initialFocus?: "general" | "api-keys";
  /** Century Egg hosted accounts use server-side keys; others must supply their own. */
  hostedLlmAccount?: boolean;
}) {
  const { ready, preferences, updatePreferences } = useUserPreferences();
  const apiKeysSectionRef = useRef<HTMLElement | null>(null);

  const initial = useMemo(() => preferences.profile?.chatDisplayId ?? "", [preferences.profile?.chatDisplayId]);
  const [chatDisplayId, setChatDisplayId] = useState(initial);
  const [anthropicKey, setAnthropicKey] = useState(preferences.userLlmApiKeys?.anthropicApiKey ?? "");
  const [openaiKey, setOpenaiKey] = useState(preferences.userLlmApiKeys?.openaiApiKey ?? "");
  const [geminiKey, setGeminiKey] = useState(preferences.userLlmApiKeys?.geminiApiKey ?? "");
  const [deepseekKey, setDeepseekKey] = useState(preferences.userLlmApiKeys?.deepseekApiKey ?? "");
  const [savedToast, setSavedToast] = useState(false);
  const [keysSavedToast, setKeysSavedToast] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [keysSaveError, setKeysSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingKeys, setSavingKeys] = useState(false);
  const [responseVerbosity, setResponseVerbosity] = useState<UserResponseVerbosity>(
    preferences.responseVerbosity === "md" ? "md" : "analyst"
  );
  const [verbositySavedToast, setVerbositySavedToast] = useState(false);
  const [verbositySaveError, setVerbositySaveError] = useState<string | null>(null);
  const [savingVerbosity, setSavingVerbosity] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChatDisplayId(initial);
    setAnthropicKey(preferences.userLlmApiKeys?.anthropicApiKey ?? "");
    setOpenaiKey(preferences.userLlmApiKeys?.openaiApiKey ?? "");
    setGeminiKey(preferences.userLlmApiKeys?.geminiApiKey ?? "");
    setDeepseekKey(preferences.userLlmApiKeys?.deepseekApiKey ?? "");
    setSavedToast(false);
    setKeysSavedToast(false);
    setSaveError(null);
    setKeysSaveError(null);
    setResponseVerbosity(preferences.responseVerbosity === "md" ? "md" : "analyst");
    setVerbositySavedToast(false);
    setVerbositySaveError(null);
  }, [open, initial, preferences.userLlmApiKeys, preferences.responseVerbosity]);

  useEffect(() => {
    if (!open || initialFocus !== "api-keys") return;
    const t = requestAnimationFrame(() => {
      apiKeysSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(t);
  }, [open, initialFocus]);

  useEffect(() => {
    if (!savedToast) return;
    const t = setTimeout(() => setSavedToast(false), 1600);
    return () => clearTimeout(t);
  }, [savedToast]);

  useEffect(() => {
    if (!keysSavedToast) return;
    const t = setTimeout(() => setKeysSavedToast(false), 1600);
    return () => clearTimeout(t);
  }, [keysSavedToast]);

  useEffect(() => {
    if (!verbositySavedToast) return;
    const t = setTimeout(() => setVerbositySavedToast(false), 1600);
    return () => clearTimeout(t);
  }, [verbositySavedToast]);

  if (!open) return null;

  const canSave = ready;
  const invalidLocal =
    chatDisplayId.trim().length > 0 && !/^[a-z0-9][a-z0-9._-]*$/i.test(chatDisplayId.trim());

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      role="dialog"
      aria-modal="true"
      aria-label="User settings"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border shadow-xl"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              User Settings
            </h3>
            <p className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
              Chat identity and BYOK LLM keys for in-app API runs (keeps hosting costs down).
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--card)]"
            style={{ color: "var(--muted2)" }}
            onClick={onClose}
            aria-label="Close settings"
          >
            ×
          </button>
        </div>

        <div className="max-h-[min(82vh,560px)] overflow-y-auto p-4">
          <section className="rounded-lg border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
            <h4 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
              Egg-Hoc chat ID
            </h4>
            <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
              This changes how your name/ID appears in the app UI. (It does not change your login email.)
            </p>
            <label className="mt-3 block text-[11px]" style={{ color: "var(--muted2)" }}>
              Display name / ID
              <input
                value={chatDisplayId}
                onChange={(e) => setChatDisplayId(e.target.value)}
                placeholder="e.g. guowei58"
                className="mt-1 w-full rounded border px-2 py-1.5 text-sm"
                style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
              />
            </label>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={!canSave || saving}
                className="rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                onClick={async () => {
                  const next = chatDisplayId.trim().toLowerCase().replace(/\s+/g, "-");
                  setSaveError(null);
                  if (next && !/^[a-z0-9][a-z0-9._-]*$/.test(next)) {
                    setSaveError('Use letters/numbers, plus ".", "_" or "-".');
                    return;
                  }
                  setSaving(true);
                  try {
                    const res = await fetch("/api/me/preferences", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        preferences: {
                          ...preferences,
                          profile: { ...(preferences.profile ?? {}), chatDisplayId: next ? next : undefined },
                        },
                      }),
                    });
                    const j = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok) throw new Error(j.error || "Save failed");
                    updatePreferences((p) => ({
                      ...p,
                      profile: { ...(p.profile ?? {}), chatDisplayId: next ? next : undefined },
                    }));
                    setSavedToast(true);
                  } catch (e) {
                    setSaveError(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              {savedToast ? (
                <span className="text-[10px]" style={{ color: "var(--accent)" }}>
                  Saved
                </span>
              ) : (
                <span className="text-[10px]" style={{ color: "var(--muted)" }}>
                  Saved to your account preferences
                </span>
              )}
            </div>
            {saveError ? (
              <p className="mt-2 text-[10px]" style={{ color: "var(--warn)" }}>
                {saveError}
              </p>
            ) : invalidLocal ? (
              <p className="mt-2 text-[10px]" style={{ color: "var(--warn)" }}>
                Use letters/numbers, plus &quot;.&quot;, &quot;_&quot; or &quot;-&quot;.
              </p>
            ) : null}
          </section>

          <section className="mt-4 rounded-lg border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
            <h4 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
              AI response depth
            </h4>
            <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
              Applies to AI Chat, research tab API runs, credit memos, decks, covenant/LME synthesis, and other in-app model calls. Analyst
              matches the original OREO default (no extra brevity rules in the global system layer). MD asks for about half the prose volume
              with the same material substance.
            </p>
            <div className="mt-3 space-y-2">
              <label className="flex cursor-pointer items-start gap-2 text-[11px]" style={{ color: "var(--text)" }}>
                <input
                  type="radio"
                  name="response-verbosity"
                  className="mt-0.5"
                  checked={responseVerbosity === "md"}
                  onChange={() => setResponseVerbosity("md")}
                  disabled={!canSave}
                />
                <span>
                  <span className="font-semibold">MD</span>
                  <span style={{ color: "var(--muted)" }}> — No time to chit-chat.</span>
                  <span className="mt-0.5 block font-normal" style={{ color: "var(--muted2)" }}>
                    Tight, scannable answers for busy readers who still need the important numbers, risks, and caveats.
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-[11px]" style={{ color: "var(--text)" }}>
                <input
                  type="radio"
                  name="response-verbosity"
                  className="mt-0.5"
                  checked={responseVerbosity === "analyst"}
                  onChange={() => setResponseVerbosity("analyst")}
                  disabled={!canSave}
                />
                <span>
                  <span className="font-semibold">Analyst</span>
                  <span style={{ color: "var(--muted)" }}> — Don&apos;t want to miss a thing.</span>
                  <span className="mt-0.5 block font-normal" style={{ color: "var(--muted2)" }}>
                    Fuller write-ups, edge cases, and nuance when they add analytical value.
                  </span>
                </span>
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={!canSave || savingVerbosity}
                className="rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                onClick={async () => {
                  setVerbositySaveError(null);
                  setSavingVerbosity(true);
                  try {
                    const nextPrefs = { ...preferences, responseVerbosity };
                    const res = await fetch("/api/me/preferences", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ preferences: nextPrefs }),
                    });
                    const j = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok) throw new Error(j.error || "Save failed");
                    updatePreferences(() => nextPrefs);
                    setVerbositySavedToast(true);
                  } catch (e) {
                    setVerbositySaveError(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setSavingVerbosity(false);
                  }
                }}
              >
                {savingVerbosity ? "Saving…" : "Save depth preference"}
              </button>
              {verbositySavedToast ? (
                <span className="text-[10px]" style={{ color: "var(--accent)" }}>
                  Saved
                </span>
              ) : null}
            </div>
            {verbositySaveError ? (
              <p className="mt-2 text-[10px]" style={{ color: "var(--warn)" }}>
                {verbositySaveError}
              </p>
            ) : null}
          </section>

          <section
            ref={(el) => {
              apiKeysSectionRef.current = el;
            }}
            className="mt-4 rounded-lg border p-3"
            style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
          >
            <h4 className="text-xs font-semibold" style={{ color: "var(--text)" }}>
              LLM API keys
            </h4>
            {hostedLlmAccount ? (
              <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--accent)" }}>
                Your account uses Century Egg Credit server API keys for Claude, ChatGPT, Gemini, and DeepSeek. You do not need to
                paste keys here unless you want to override them with your own.
              </p>
            ) : (
              <>
                <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                  {USER_LLM_API_KEYS_POLICY}
                </p>
                <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
                  Keys below are stored with your login and are not shared with other users. Use the in-app &quot;Claude API&quot;,
                  &quot;ChatGPT API&quot;, &quot;Gemini API&quot;, and &quot;DeepSeek API&quot; actions from AI Chat, research tabs,
                  credit memo tools, and elsewhere.
                </p>
              </>
            )}

            <div className="mt-3 grid grid-cols-1 gap-3">
              <div>
                <label className="block text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
                  Anthropic (Claude) API key
                </label>
                <a
                  href={LLM_LINKS.anthropic}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-[10px] underline"
                  style={{ color: "var(--accent)" }}
                >
                  Get a key at console.anthropic.com
                </a>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => setAnthropicKey(e.target.value)}
                  placeholder="sk-ant-api03-…"
                  autoComplete="off"
                  disabled={!canSave}
                  className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                  style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
                  OpenAI (ChatGPT) API key
                </label>
                <a
                  href={LLM_LINKS.openai}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-[10px] underline"
                  style={{ color: "var(--accent)" }}
                >
                  Get a key at platform.openai.com
                </a>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => setOpenaiKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  disabled={!canSave}
                  className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                  style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
                  Google Gemini API key
                </label>
                <a
                  href={LLM_LINKS.gemini}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-[10px] underline"
                  style={{ color: "var(--accent)" }}
                >
                  Get a key at Google AI Studio
                </a>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => setGeminiKey(e.target.value)}
                  placeholder="AIza…"
                  autoComplete="off"
                  disabled={!canSave}
                  className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                  style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
                />
              </div>
              <div>
                <label className="block text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
                  DeepSeek API key
                </label>
                <a
                  href={LLM_LINKS.deepseek}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-0.5 inline-block text-[10px] underline"
                  style={{ color: "var(--accent)" }}
                >
                  Get a key at platform.deepseek.com
                </a>
                <input
                  type="password"
                  value={deepseekKey}
                  onChange={(e) => setDeepseekKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                  disabled={!canSave}
                  className="mt-1 w-full rounded border px-2 py-1.5 font-mono text-xs"
                  style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
                />
              </div>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!canSave || savingKeys}
                className="rounded border px-3 py-1.5 text-xs font-semibold disabled:opacity-60"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                onClick={async () => {
                  setKeysSaveError(null);
                  setSavingKeys(true);
                  try {
                    const userLlmApiKeys: NonNullable<(typeof preferences)["userLlmApiKeys"]> = {};
                    if (anthropicKey.trim()) userLlmApiKeys.anthropicApiKey = anthropicKey.trim();
                    if (openaiKey.trim()) userLlmApiKeys.openaiApiKey = openaiKey.trim();
                    if (geminiKey.trim()) userLlmApiKeys.geminiApiKey = geminiKey.trim();
                    if (deepseekKey.trim()) userLlmApiKeys.deepseekApiKey = deepseekKey.trim();
                    const nextPrefs = {
                      ...preferences,
                      userLlmApiKeys: Object.keys(userLlmApiKeys).length > 0 ? userLlmApiKeys : undefined,
                    };
                    const res = await fetch("/api/me/preferences", {
                      method: "PUT",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ preferences: nextPrefs }),
                    });
                    const j = (await res.json()) as { ok?: boolean; error?: string };
                    if (!res.ok) throw new Error(j.error || "Save failed");
                    updatePreferences(() => nextPrefs);
                    setKeysSavedToast(true);
                  } catch (e) {
                    setKeysSaveError(e instanceof Error ? e.message : "Save failed");
                  } finally {
                    setSavingKeys(false);
                  }
                }}
              >
                {savingKeys ? "Saving…" : "Save API keys"}
              </button>
              {keysSavedToast ? (
                <span className="text-[10px]" style={{ color: "var(--accent)" }}>
                  Keys saved
                </span>
              ) : null}
            </div>
            {keysSaveError ? (
              <p className="mt-2 text-[10px]" style={{ color: "var(--warn)" }}>
                {keysSaveError}
              </p>
            ) : null}
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border2)" }}>
          <button
            type="button"
            className="rounded border px-3 py-1.5 text-xs font-semibold"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
            onClick={onClose}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
