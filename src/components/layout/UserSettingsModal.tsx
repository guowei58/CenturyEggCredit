"use client";

import { useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

export function UserSettingsModal({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { ready, preferences, updatePreferences } = useUserPreferences();

  const initial = useMemo(() => preferences.profile?.chatDisplayId ?? "", [preferences.profile?.chatDisplayId]);
  const [chatDisplayId, setChatDisplayId] = useState(initial);
  const [savedToast, setSavedToast] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChatDisplayId(initial);
    setSavedToast(false);
    setSaveError(null);
  }, [open, initial]);

  useEffect(() => {
    if (!savedToast) return;
    const t = setTimeout(() => setSavedToast(false), 1600);
    return () => clearTimeout(t);
  }, [savedToast]);

  if (!open) return null;

  const canSave = ready;
  const invalidLocal =
    chatDisplayId.trim().length > 0 &&
    !/^[a-z0-9][a-z0-9._-]*$/i.test(chatDisplayId.trim());

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
              Customize your chat identity and reserve space for API keys.
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 transition-colors hover:bg-[var(--card)]"
            style={{ color: "var(--muted2)" }}
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
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
                  const next = chatDisplayId
                    .trim()
                    .toLowerCase()
                    .replace(/\s+/g, "-");
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
              API keys (coming soon)
            </h4>
            <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
              You’ll be able to paste your own keys here later. For now, these inputs are placeholders.
            </p>

            <div className="mt-3 grid grid-cols-1 gap-2">
              {[
                { label: "OpenAI API key", placeholder: "sk-…" },
                { label: "Anthropic API key", placeholder: "sk-ant-…" },
                { label: "NewsAPI key", placeholder: "…" },
                { label: "Finnhub key", placeholder: "…" },
                { label: "Alpha Vantage key", placeholder: "…" },
              ].map((f) => (
                <label key={f.label} className="block text-[11px]" style={{ color: "var(--muted2)" }}>
                  {f.label}
                  <input
                    value=""
                    onChange={() => {}}
                    disabled
                    placeholder={f.placeholder}
                    className="mt-1 w-full rounded border px-2 py-1.5 text-sm opacity-80"
                    style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
                  />
                </label>
              ))}
            </div>
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

