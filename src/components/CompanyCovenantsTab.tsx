"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { aiProviderChipStyle, type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import { AiModelPicker } from "@/components/AiModelPicker";
import { useUserPreferences } from "@/components/UserPreferencesProvider";

type SourceRow = {
  label: string;
  key?: string;
  chars: number;
  truncated: boolean;
  isBinaryPlaceholder: boolean;
};

type CovenantGetResponse = {
  ticker: string;
  sourceInventory: SourceRow[];
  totalChars: number;
  hasSubstantiveText: boolean;
  currentFingerprint: string;
  cacheFingerprint: string | null;
  cacheStale: boolean;
  cacheUpdatedAt: string | null;
  cachedMarkdown: string | null;
  anthropicConfigured: boolean;
  openaiConfigured: boolean;
  geminiConfigured?: boolean;
  deepseekConfigured?: boolean;
  deepseekDefaultModel?: string;
};

export function CompanyCovenantsTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const [data, setData] = useState<CovenantGetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiProvider, setAiProvider] = useState<AiProvider>("claude");

  useEffect(() => {
    if (!prefsReady) return;
    const n = normalizeAiProvider(preferences.aiProvider);
    if (n) setAiProvider(n);
  }, [prefsReady, preferences.aiProvider]);

  const persistProvider = useCallback(
    (p: AiProvider) => {
      setAiProvider(p);
      updatePreferences((prev) => ({ ...prev, aiProvider: p }));
    },
    [updatePreferences]
  );

  const load = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/covenants/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as CovenantGetResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load covenants");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [safeTicker]);

  useEffect(() => {
    void load();
  }, [load]);

  async function regenerate() {
    if (!safeTicker) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/covenants/${encodeURIComponent(safeTicker)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, ...modelOverridePayloadForProvider(aiProvider) }),
      });
      const body = (await res.json()) as { ok?: boolean; markdown?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Generation failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Covenants">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to view covenant synthesis.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card title={`Covenants — ${safeTicker}`}>
        <div className="flex items-center gap-2 py-8" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Loading sources…
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card title={`Covenants — ${safeTicker}`}>
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      </Card>
    );
  }

  if (!data) return null;

  const deepseekReady = data.deepseekConfigured === true;

  const providerReady =
    aiProvider === "claude"
      ? data.anthropicConfigured
      : aiProvider === "openai"
        ? data.openaiConfigured
        : aiProvider === "gemini"
          ? data.geminiConfigured === true
          : deepseekReady;

  return (
    <div className="space-y-6">
      <Card title={`Covenants — ${safeTicker}`}>
        <p className="text-[11px] leading-relaxed mb-4" style={{ color: "var(--muted2)" }}>
          This page aggregates saved text from <strong>Credit Agreements &amp; Indentures</strong> (all response boxes, legacy save,
          and readable uploads: .txt / .md / .csv). It also includes <strong>Notes &amp; Thoughts</strong> and{" "}
          <strong>Capital Structure</strong> saved responses as supplemental context. Click <strong>Regenerate</strong> to have
          Claude, ChatGPT (API), Gemini, or DeepSeek synthesize the covenant package from those sources.
        </p>

        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-[11px] font-medium" style={{ color: "var(--muted2)" }}>
            Provider:
          </span>
          <div className="inline-flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
            <button
              type="button"
              onClick={() => persistProvider("claude")}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={aiProviderChipStyle(aiProvider, "claude")}
            >
              Claude
            </button>
            <button
              type="button"
              onClick={() => persistProvider("openai")}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
              style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "openai") }}
            >
              ChatGPT
            </button>
            <button
              type="button"
              onClick={() => persistProvider("gemini")}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
              style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "gemini") }}
              title="Gemini — GEMINI_API_KEY / GEMINI_MODEL"
            >
              Gemini
            </button>
            <button
              type="button"
              onClick={() => persistProvider("deepseek")}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
              style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "deepseek") }}
              title={`DeepSeek — ${data.deepseekDefaultModel ?? "deepseek-chat"}`}
            >
              DeepSeek
            </button>
          </div>
          <AiModelPicker provider={aiProvider} className="mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto" />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={generating || !data.hasSubstantiveText || !providerReady}
            className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              background: "transparent",
            }}
          >
            {generating ? "Generating…" : "Regenerate covenant summary"}
          </button>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded border px-3 py-2 text-xs font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            Refresh sources
          </button>
          {data.cacheStale && data.cachedMarkdown && (
            <span className="text-[11px]" style={{ color: "var(--warn)" }}>
              Sources changed since last synthesis — regenerate recommended.
            </span>
          )}
        </div>

        {!providerReady && (
          <p className="text-xs mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
            {aiProvider === "claude" ? (
              <>
                Set <span className="font-mono">ANTHROPIC_API_KEY</span> in <span className="font-mono">.env.local</span> to synthesize
                with Claude, or switch to another model.
              </>
            ) : aiProvider === "openai" ? (
              <>
                Set <span className="font-mono">OPENAI_API_KEY</span> in <span className="font-mono">.env.local</span> to synthesize with
                ChatGPT, or switch to another model.
              </>
            ) : aiProvider === "gemini" ? (
              <>
                Set <span className="font-mono">GEMINI_API_KEY</span> in <span className="font-mono">.env.local</span> to synthesize with
                Gemini, or switch to another model.
              </>
            ) : (
              <>
                Add a DeepSeek API key in <strong>User Settings</strong> (gear icon), or use a hosted account with{" "}
                <span className="font-mono">DEEPSEEK_API_KEY</span> on the server.
              </>
            )}
          </p>
        )}

        {error && (
          <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}

        <div className="rounded border mb-4 text-xs" style={{ borderColor: "var(--border2)" }}>
          <div className="px-3 py-2 font-semibold" style={{ background: "var(--card2)", color: "var(--muted2)" }}>
            Source inventory ({data.sourceInventory.length} blocks, {data.totalChars.toLocaleString()} characters)
          </div>
          <ul className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: "var(--border2)" }}>
            {data.sourceInventory.map((s) => (
              <li key={`${s.label}-${s.key ?? s.chars}`} className="px-3 py-1.5 flex justify-between gap-2" style={{ color: "var(--text)" }}>
                <span className="min-w-0 truncate" title={s.label}>
                  {s.label}
                  {s.truncated ? " · truncated" : ""}
                </span>
                <span className="font-mono flex-shrink-0" style={{ color: "var(--muted)" }}>
                  {s.isBinaryPlaceholder ? "—" : s.chars.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
          {!data.hasSubstantiveText && (
            <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
              No substantive saved text yet. Paste AI output or notes into the Credit Agreements &amp; Indentures boxes, then regenerate.
            </p>
          )}
        </div>

        {data.cacheUpdatedAt && (
          <p className="text-[10px] mb-4" style={{ color: "var(--muted)" }}>
            Last synthesized: {new Date(data.cacheUpdatedAt).toLocaleString()}
          </p>
        )}
      </Card>

      {data.cachedMarkdown ? (
        <Card title="Covenant synthesis">
          <div
            className="prose-covenants text-sm leading-relaxed max-w-none"
            style={{ color: "var(--text)" }}
          >
            <SavedRichText content={data.cachedMarkdown} ticker={safeTicker} />
          </div>
        </Card>
      ) : (
        <Card title="Covenant synthesis">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            No synthesis yet. Save covenant-related content under Credit Agreements &amp; Indentures, then click{" "}
            <strong>Regenerate covenant summary</strong>.
          </p>
        </Card>
      )}
    </div>
  );
}
