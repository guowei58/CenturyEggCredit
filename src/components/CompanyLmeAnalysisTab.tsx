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

type LmeGetResponse = {
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
  ollamaStatus?: "connected" | "disconnected" | "model_missing" | "error";
  ollamaModel?: string;
  needsSignIn?: boolean;
};

export function CompanyLmeAnalysisTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const [data, setData] = useState<LmeGetResponse | null>(null);
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
      const res = await fetch(`/api/lme-analysis/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as LmeGetResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load LME analysis");
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
      const res = await fetch(`/api/lme-analysis/${encodeURIComponent(safeTicker)}`, {
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
      <Card title="LME Analysis">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to run liability management analysis.
        </p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card title={`LME Analysis — ${safeTicker}`}>
        <div className="flex items-center gap-2 py-8" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Loading sources…
        </div>
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card title={`LME Analysis — ${safeTicker}`}>
        <p className="text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      </Card>
    );
  }

  if (!data) return null;

  const ollamaState = data.ollamaStatus ?? "error";
  const ollamaModelLabel = data.ollamaModel?.trim() || "llama3.1:8b";
  const needsSignIn = data.needsSignIn === true;

  const providerReady =
    aiProvider === "claude"
      ? data.anthropicConfigured
      : aiProvider === "openai"
        ? data.openaiConfigured
        : aiProvider === "gemini"
          ? data.geminiConfigured === true
          : ollamaState === "connected";

  return (
    <div className="space-y-6">
      <Card title={`LME Analysis — ${safeTicker}`}>
        <p className="text-[11px] leading-relaxed mb-4" style={{ color: "var(--muted2)" }}>
          This tab bundles everything saved under <strong>Capital Structure</strong> for this ticker: Capital Structure and Org
          Chart responses (and uploaded .xlsx workbooks), <strong>Subsidiary List</strong> (saved text and Excel), and all{" "}
          <strong>Credit Agreements &amp; Indentures</strong> saved boxes plus readable uploads (.txt / .md / .csv). Click{" "}
          <strong>Run LME analysis</strong> to send that corpus to your chosen model with a distressed-credit LME mandate.
          Output is saved here for this ticker.
        </p>

        {needsSignIn && (
          <p className="text-xs mb-4 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
            Sign in to load saved Capital Structure sources and run analysis. Your saved tab content is stored per account.
          </p>
        )}

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
            >
              Gemini
            </button>
            <button
              type="button"
              onClick={() => persistProvider("ollama")}
              className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
              style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "ollama") }}
              title={`Ollama — ${data.ollamaModel} (${data.ollamaStatus})`}
            >
              Ollama
            </button>
          </div>
          <AiModelPicker provider={aiProvider} className="mt-2 w-full sm:mt-0 sm:ml-2 sm:w-auto" />
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-4">
          <button
            type="button"
            onClick={() => void regenerate()}
            disabled={generating || !data.hasSubstantiveText || !providerReady || needsSignIn}
            className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
            style={{
              borderColor: "var(--accent)",
              color: "var(--accent)",
              background: "transparent",
            }}
          >
            {generating ? "Running analysis…" : "Run LME analysis"}
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
              Sources changed since last run — run again for an updated memo.
            </span>
          )}
        </div>

        {!providerReady && !needsSignIn && (
          <p className="text-xs mb-3 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
            {aiProvider === "claude" ? (
              <>
                Set <span className="font-mono">ANTHROPIC_API_KEY</span> in <span className="font-mono">.env.local</span>, or switch
                provider.
              </>
            ) : aiProvider === "openai" ? (
              <>
                Set <span className="font-mono">OPENAI_API_KEY</span> in <span className="font-mono">.env.local</span>, or switch
                provider.
              </>
            ) : aiProvider === "gemini" ? (
              <>
                Set <span className="font-mono">GEMINI_API_KEY</span> in <span className="font-mono">.env.local</span>, or switch
                provider.
              </>
            ) : ollamaState === "disconnected" ? (
              <>Ollama is not reachable. Run <span className="font-mono">ollama serve</span>.</>
            ) : ollamaState === "model_missing" ? (
              <>
                Pull the model: <span className="font-mono">ollama pull {ollamaModelLabel}</span>
              </>
            ) : (
              <>Ollama health check failed. See docs for Ollama setup.</>
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
          <ul className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: "var(--border2)" }}>
            {data.sourceInventory.map((s) => (
              <li
                key={`${s.label}-${s.key ?? s.chars}`}
                className="px-3 py-1.5 flex justify-between gap-2"
                style={{ color: "var(--text)" }}
              >
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
          {!data.hasSubstantiveText && !needsSignIn && (
            <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
              No substantive saved content yet. Fill the Capital Structure, Org Chart, Subsidiary List, and Credit Agreements
              tabs, then refresh.
            </p>
          )}
        </div>

        {data.cacheUpdatedAt && (
          <p className="text-[10px] mb-4" style={{ color: "var(--muted)" }}>
            Last run: {new Date(data.cacheUpdatedAt).toLocaleString()}
          </p>
        )}
      </Card>

      {data.cachedMarkdown ? (
        <Card title="LME analysis output">
          <div className="prose-covenants text-sm leading-relaxed max-w-none" style={{ color: "var(--text)" }}>
            <SavedRichText content={data.cachedMarkdown} ticker={safeTicker} />
          </div>
        </Card>
      ) : (
        <Card title="LME analysis output">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            No analysis yet. Save capital structure / org chart / subsidiary / covenant sources, then click{" "}
            <strong>Run LME analysis</strong>.
          </p>
        </Card>
      )}
    </div>
  );
}
