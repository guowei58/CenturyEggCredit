"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { aiProviderChipStyle, type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import { AiModelPicker } from "@/components/AiModelPicker";
import { ProviderPublicLimitsSidePanel } from "@/components/credit-memo/ProviderPublicLimitsSidePanel";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { resolvedUserModelIdForProvider } from "@/lib/ai-model-prefs-client";

type SourceRow = {
  label: string;
  key?: string;
  charsInitial: number;
  truncated: boolean;
  isBinaryPlaceholder: boolean;
};

type CsRecGetResponse = {
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
  needsSignIn?: boolean;
  retrievalUsed?: boolean;
};

export function CompanyCapStructureRecommendationTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const { status: authStatus } = useSession();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const [data, setData] = useState<CsRecGetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastSentMessages, setLastSentMessages] = useState<{ system: string; user: string } | null>(null);
  type CsRecPackingStatsRow = {
    rawSourceCharsSum: number;
    packedPartsCharSum: number;
    bundleCharCap: number;
    perPartCharCap: number;
    retrievalUsed: boolean;
    blocksInPack: number;
    retrievalPack?: {
      mode: "global" | "legacy_queue";
      task: "lme" | "kpi" | "forensic";
      chunksBuilt: number;
      chunksEmbedded: number;
      chunkCap?: number;
      corpusChunksWereCapped: boolean;
      chunksInWindow: number;
      rankingQueryLines: string[];
      documentsInWindow: Array<{
        docId: string;
        label: string;
        key?: string;
        file?: string;
        chunksFromDocInWindow: number;
      }>;
    } | null;
  };
  type CsRecUserMsgBreakdown = {
    taskSpecChars: number;
    bridgeChars: number;
    formattedSourcesChars: number;
    totalUserMessageChars: number;
  };
  const [lastRunDiagnostics, setLastRunDiagnostics] = useState<{
    packing: CsRecPackingStatsRow;
    userBreakdown: CsRecUserMsgBreakdown;
    systemChars: number;
  } | null>(null);
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
      const res = await fetch(`/api/cs-recommendation/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as CsRecGetResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load recommendation");
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [safeTicker]);

  useEffect(() => {
    if (!prefsReady || !safeTicker) return;
    void load();
  }, [prefsReady, safeTicker, load]);

  useEffect(() => {
    setLastSentMessages(null);
    setLastRunDiagnostics(null);
  }, [safeTicker]);

  async function regenerate() {
    if (!safeTicker) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/cs-recommendation/${encodeURIComponent(safeTicker)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: aiProvider, ...modelOverridePayloadForProvider(aiProvider) }),
      });
      const body = (await res.json()) as {
        ok?: boolean;
        markdown?: string;
        error?: string;
        sentSystemMessage?: string;
        sentUserMessage?: string;
        packingStats?: CsRecPackingStatsRow | null;
        userMessageBreakdown?: CsRecUserMsgBreakdown;
      };
      if (!res.ok) throw new Error(body.error ?? "Generation failed");
      if (typeof body.sentSystemMessage === "string" && typeof body.sentUserMessage === "string") {
        setLastSentMessages({ system: body.sentSystemMessage, user: body.sentUserMessage });
        if (
          body.packingStats &&
          body.userMessageBreakdown &&
          typeof body.userMessageBreakdown.taskSpecChars === "number"
        ) {
          setLastRunDiagnostics({
            packing: { ...body.packingStats },
            userBreakdown: body.userMessageBreakdown,
            systemChars: body.sentSystemMessage.length,
          });
        } else {
          setLastRunDiagnostics(null);
        }
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Recommendation">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to run capital structure protection recommendations.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const deepseekReady = data?.deepseekConfigured === true;

  const providerReady = data
    ? aiProvider === "claude"
      ? data.anthropicConfigured
      : aiProvider === "openai"
        ? data.openaiConfigured
        : aiProvider === "gemini"
          ? data.geminiConfigured === true
          : deepseekReady
    : false;

  return (
    <div className="space-y-6">
      <Card title={`Recommendation — ${safeTicker}`}>
        <div className="flex flex-col lg:flex-row lg:gap-6 lg:items-start">
          <div className="min-w-0 flex-1">
            {(loading || (!prefsReady && safeTicker)) ? (
              <p className="text-[11px] mb-3 flex items-center gap-2" style={{ color: "var(--muted)" }}>
                <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
                {!prefsReady ? "Preparing tab…" : data ? "Refreshing sources…" : "Loading source inventory…"}
              </p>
            ) : null}
            <ol
              className="text-[11px] leading-relaxed mb-4 list-decimal space-y-1.5 pl-5"
              style={{ color: "var(--muted2)" }}
            >
              <li>
                Click <strong>Refresh sources</strong> to rescan your full workspace and saved tabs (non-Excel files, including saved LME / KPI / Forensic outputs).
              </li>
              <li>Pick the AI model.</li>
              <li>
                Click <strong>Run recommendation</strong> to send request to AI model via API.
              </li>
            </ol>

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
                  onClick={() => persistProvider("deepseek")}
                  className="px-3 py-1.5 text-[11px] font-medium transition-colors border-l"
                  style={{ borderColor: "var(--border2)", ...aiProviderChipStyle(aiProvider, "deepseek") }}
                  title={`DeepSeek — ${data?.deepseekDefaultModel ?? "deepseek-chat"}`}
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
                disabled={generating || loading || !prefsReady || !data?.hasSubstantiveText || !providerReady || needsSignIn}
                className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  background: "transparent",
                }}
              >
                {generating ? "Running analysis…" : "Run recommendation"}
              </button>
              <button
                type="button"
                onClick={() => void load()}
                disabled={generating || loading || !prefsReady}
                className="rounded border px-3 py-2 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Refresh sources
              </button>
              {data?.cacheStale && data.cachedMarkdown && (
                <span className="text-[11px]" style={{ color: "var(--warn)" }}>
                  Sources changed since last run — run again for an updated memo.
                </span>
              )}
            </div>

            {!providerReady && !needsSignIn && data && !loading && (
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
                ) : (
                  <>
                    Add a DeepSeek API key in <strong>User Settings</strong>, or use a hosted account with{" "}
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
              <div
                className="px-3 py-2 font-semibold"
                style={{ background: "var(--card2)", color: "var(--muted2)" }}
                title="Total is the sum of each row’s Chars column (full saved or extracted length on refresh; Run applies model caps and retrieval)."
              >
                {data ? (
                  <>
                    Source inventory ({data.sourceInventory.length} blocks, {data.totalChars.toLocaleString()} characters)
                  </>
                ) : (
                  <>Source inventory</>
                )}
              </div>
              {!prefsReady ? (
                <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                  Preparing tab…
                </p>
              ) : error && !data ? (
                <p className="px-3 py-2 text-sm" style={{ color: "var(--danger)" }}>
                  {error}
                </p>
              ) : loading && !data ? (
                <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                  Scanning workspace and saved tabs (all non-Excel files; includes LME, KPI, and Forensic outputs when saved)…
                </p>
              ) : data ? (
                <>
                  <div
                    className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-2 border-b px-3 py-1.5 text-[9px] font-semibold leading-tight sm:grid-cols-[minmax(0,1fr)_6.75rem] sm:text-[10px]"
                    style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                  >
                    <span>Source</span>
                    <span
                      className="text-right whitespace-normal"
                      title="Character count of saved or extracted text for this block (before per-source truncation)"
                    >
                      Chars
                    </span>
                  </div>
                  <ul className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: "var(--border2)" }}>
                    {data.sourceInventory.map((s) => {
                      const initial = typeof s.charsInitial === "number" ? s.charsInitial : 0;
                      return (
                        <li
                          key={`${s.label}-${s.key ?? ""}-${initial}`}
                          className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-2 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_6.75rem]"
                          style={{ color: "var(--text)" }}
                        >
                          <span className="min-w-0 truncate" title={s.label}>
                            {s.label}
                            {s.truncated ? " · truncated" : ""}
                          </span>
                          <span
                            className="text-right font-mono text-[10px] tabular-nums sm:text-[11px]"
                            style={{ color: "var(--muted)" }}
                            title="Saved or extracted length (before per-source truncation)"
                          >
                            {s.isBinaryPlaceholder ? "—" : initial.toLocaleString()}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                  {!data.hasSubstantiveText && !needsSignIn && (
                    <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                    No substantive text yet. Add non-Excel files or saved tab content to your workspace (prior LME, KPI, and Forensic runs count when saved), then refresh.
                    </p>
                  )}
                </>
              ) : (
                <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
                  Source list will appear here after the first load.
                </p>
              )}
            </div>

            {data?.cacheUpdatedAt ? (
              <p className="text-[10px] mb-4" style={{ color: "var(--muted)" }}>
                Last run: {new Date(data.cacheUpdatedAt).toLocaleString()}
              </p>
            ) : null}
          </div>
          <ProviderPublicLimitsSidePanel
            provider={aiProvider}
            resolvedModelId={resolvedUserModelIdForProvider(aiProvider)}
            className="w-full shrink-0 lg:sticky lg:top-4 lg:w-[min(100%,320px)]"
          />
        </div>
      </Card>

      {lastSentMessages ? (
        <Card title="Last run — prompt sent to the model">
          <details
            className="mb-4 rounded border text-[11px] leading-snug overflow-x-auto"
            style={{ borderColor: "var(--border2)" }}
          >
            <summary
              className="cursor-pointer px-3 py-2 text-xs font-medium"
              style={{ background: "var(--card2)" }}
            >
              Run guide — size diagnostics
            </summary>
            <div className="border-t" style={{ borderColor: "var(--border2)" }}>
              <p className="px-3 py-2 mb-0 leading-relaxed" style={{ color: "var(--muted2)" }}>
                From your last <strong>Run recommendation</strong>. The <strong>user message</strong> is two parts: (1) the
                built-in capital-structure protection task spec (not taken from your tabs), then (2){" "}
                <span className="font-mono">SOURCE DOCUMENTS</span>, which is your packed workspace for that run. Refresh clears
                this panel.
              </p>
              {lastRunDiagnostics ? (
                <>
                  <div
                    className="px-3 py-2 font-semibold border-t"
                    style={{ background: "var(--card2)", color: "var(--muted2)", borderColor: "var(--border2)" }}
                  >
                    How size was computed (last run)
                  </div>
                  <table className="w-full min-w-[280px] text-left border-t" style={{ borderColor: "var(--border2)" }}>
                    <tbody style={{ color: "var(--text)" }}>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top w-[52%]" style={{ color: "var(--muted2)" }}>
                          Raw sources total
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.packing.rawSourceCharsSum.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Per-source cap (each block trimmed first)
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.packing.perPartCharCap.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Bundle cap (max sum of packed block bodies)
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.packing.bundleCharCap.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Packed block bodies (after caps; {lastRunDiagnostics.packing.blocksInPack} blocks)
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.packing.packedPartsCharSum.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Embedding retrieval (chunk/rank excerpts)
                        </th>
                        <td className="px-3 py-1.5">
                          {lastRunDiagnostics.packing.retrievalUsed ? (
                            lastRunDiagnostics.packing.retrievalPack ? (
                              <span style={{ color: "var(--accent)" }}>
                                {lastRunDiagnostics.packing.retrievalPack.mode === "global"
                                  ? `Full-corpus ranked pack (${lastRunDiagnostics.packing.retrievalPack.task.toUpperCase()} task query)`
                                  : "Long-document queue (legacy LME fallback)"}
                              </span>
                            ) : (
                              <span style={{ color: "var(--accent)" }}>Used</span>
                            )
                          ) : (
                            <span style={{ color: "var(--muted)" }}>
                              Not used (add OpenAI, Gemini, or DeepSeek embedding key in Settings)
                            </span>
                          )}
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Formatted sources string (bodies + SOURCE headers)
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.userBreakdown.formattedSourcesChars.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Built-in recommendation task spec
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.userBreakdown.taskSpecChars.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          Banner (--- + SOURCE DOCUMENTS line)
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.userBreakdown.bridgeChars.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          User message total
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums font-semibold">
                          {lastRunDiagnostics.userBreakdown.totalUserMessageChars.toLocaleString()} chars
                        </td>
                      </tr>
                      <tr>
                        <th className="px-3 py-1.5 font-medium align-top" style={{ color: "var(--muted2)" }}>
                          System message
                        </th>
                        <td className="px-3 py-1.5 font-mono tabular-nums">
                          {lastRunDiagnostics.systemChars.toLocaleString()} chars
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  {lastRunDiagnostics.packing.retrievalPack ? (
                    <div
                      className="border-t px-3 py-2 text-[10px] leading-relaxed space-y-2"
                      style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                    >
                      <div className="font-semibold" style={{ color: "var(--muted2)" }}>
                        Ranked retrieval details
                      </div>
                      <ul className="list-none space-y-1 pl-0" style={{ color: "var(--muted)" }}>
                        <li>
                          <span className="font-medium" style={{ color: "var(--text)" }}>Chunks from corpus: </span>
                          {lastRunDiagnostics.packing.retrievalPack.corpusChunksWereCapped ? (
                            <>
                              {lastRunDiagnostics.packing.retrievalPack.chunksBuilt.toLocaleString()} built →{" "}
                              {lastRunDiagnostics.packing.retrievalPack.chunksEmbedded.toLocaleString()} sent to the embedding API
                              {lastRunDiagnostics.packing.retrievalPack.chunkCap != null
                                ? ` (cap ${lastRunDiagnostics.packing.retrievalPack.chunkCap.toLocaleString()})`
                                : ""}
                            </>
                          ) : (
                            <>
                              {lastRunDiagnostics.packing.retrievalPack.chunksBuilt.toLocaleString()} built and sent to the embedding
                              API
                            </>
                          )}
                        </li>
                        <li>
                          <span className="font-medium" style={{ color: "var(--text)" }}>
                            Chunks packed into the final context window:{" "}
                          </span>
                          {lastRunDiagnostics.packing.retrievalPack.chunksInWindow.toLocaleString()} (cosine rank + per-doc diversity +
                          bundle character budget)
                        </li>
                      </ul>
                      <div>
                        <div className="font-semibold mb-0.5" style={{ color: "var(--muted2)" }}>
                          Phrase lines used for the ranking query (embedded as one query vector per run)
                        </div>
                        <ul className="list-disc pl-4 space-y-1 font-mono text-[9px] break-words opacity-95 max-h-36 overflow-y-auto">
                          {lastRunDiagnostics.packing.retrievalPack.rankingQueryLines.map((line, i) => (
                            <li key={`rq-${i}`}>{line}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <div className="font-semibold mb-0.5" style={{ color: "var(--muted2)" }}>
                          Source documents with at least one chunk in the window
                        </div>
                        <div className="max-h-44 overflow-y-auto rounded border" style={{ borderColor: "var(--border2)" }}>
                          <table className="w-full min-w-[280px] text-left text-[9px]">
                            <thead style={{ color: "var(--muted2)" }}>
                              <tr className="border-b" style={{ borderColor: "var(--border2)" }}>
                                <th className="px-2 py-1 font-medium w-8">#</th>
                                <th className="px-2 py-1 font-medium">Document</th>
                                <th className="px-2 py-1 font-medium text-right">Chunks</th>
                              </tr>
                            </thead>
                            <tbody>
                              {lastRunDiagnostics.packing.retrievalPack.documentsInWindow.map((d, idx) => (
                                <tr key={d.docId} className="border-b" style={{ borderColor: "var(--border2)" }}>
                                  <td className="px-2 py-1 font-mono tabular-nums align-top" style={{ color: "var(--muted)" }}>
                                    {idx + 1}
                                  </td>
                                  <td className="px-2 py-1 align-top min-w-0">
                                    <div className="truncate" title={d.label}>
                                      {d.label}
                                    </div>
                                    {d.file ? (
                                      <div className="truncate font-mono opacity-80" title={d.file}>
                                        {d.file}
                                      </div>
                                    ) : d.key ? (
                                      <div className="truncate font-mono opacity-80" title={d.key}>
                                        key:{d.key}
                                      </div>
                                    ) : null}
                                  </td>
                                  <td className="px-2 py-1 font-mono tabular-nums text-right align-top">
                                    {d.chunksFromDocInWindow.toLocaleString()}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  ) : null}
                  <p className="px-3 py-2 text-[10px] leading-relaxed border-t" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
                    <strong>{lastRunDiagnostics.packing.bundleCharCap.toLocaleString()}</strong> is a <em>ceiling</em> on the sum of packed
                    block bodies. Your run totalled <strong>{lastRunDiagnostics.packing.packedPartsCharSum.toLocaleString()}</strong>{" "}
                    because that is how much text remained after per-source limits, retrieval (where applicable), and bundle trimming—not
                    because the system “shrinks” to 520k by default. The user message also adds the task spec, banner, and{" "}
                    <code className="font-mono">SOURCE:</code> framing on top of the formatted sources string.
                  </p>
                </>
              ) : null}
            </div>
          </details>
          <details className="mb-2 rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium" style={{ background: "var(--card2)" }}>
              System message ({lastSentMessages.system.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[10px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {lastSentMessages.system}
            </pre>
          </details>
          <details className="rounded border" style={{ borderColor: "var(--border2)" }}>
            <summary className="cursor-pointer px-3 py-2 text-xs font-medium" style={{ background: "var(--card2)" }}>
              User message — task + sources ({lastSentMessages.user.length.toLocaleString()} characters)
            </summary>
            <pre
              className="max-h-[min(70vh,32rem)] overflow-auto whitespace-pre-wrap break-words px-3 py-2 text-[10px] leading-snug font-mono border-t"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            >
              {lastSentMessages.user}
            </pre>
          </details>
        </Card>
      ) : null}

      {data?.cachedMarkdown?.trim() ? (
        <Card title="Recommendation output">
          <div className="prose-covenants text-sm leading-relaxed max-w-none" style={{ color: "var(--text)" }}>
            <SavedRichText content={data.cachedMarkdown} ticker={safeTicker} />
          </div>
        </Card>
      ) : (
        <Card title="Recommendation output">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            {data
              ? "No recommendation yet. Add workspace files or saved tabs (including LME / KPI / Forensic outputs when saved), then click Run recommendation."
              : "Saved recommendation output will appear here after you run."}
          </p>
        </Card>
      )}
    </div>
  );
}
