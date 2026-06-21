"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { WorkProductStepToolbar } from "@/components/WorkProductStepToolbar";
import { WorkProductIngestSourcePicker } from "@/components/WorkProductIngestSourcePicker";
import {
  sumDocumentPackedChars,
  WorkProductSourceInventoryTable,
} from "@/components/WorkProductSourceInventoryTable";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { fetchSavedTabContent, saveToServer, type SavedDataKey } from "@/lib/saved-data-client";
import type { LmeDocumentPackedRow } from "@/lib/lme-sources";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";
import { applyWorkProductIngestPending } from "@/lib/work-product-ingest-client";
import {
  formatWorkProductSourceProgressLine,
  pollWorkProductSourceProgress,
} from "@/lib/work-product-source-progress-client";
import type { LmeRunPackingStats } from "@/lib/lme-sources";
import {
  formatWorkProductContextBuildSummary,
  readWorkProductContextBuildCache,
  writeWorkProductContextBuildCache,
  type WorkProductContextBuildCache,
} from "@/lib/work-product-context-build-cache";

type SourceRow = {
  label: string;
  key?: string;
  charsInitial: number;
  truncated: boolean;
  isBinaryPlaceholder: boolean;
};

type SourceGetResponse = {
  ticker: string;
  sourceInventory: SourceRow[];
  totalChars: number;
  hasSubstantiveText: boolean;
  currentFingerprint: string;
  cacheFingerprint: string | null;
  cacheStale: boolean;
  cacheUpdatedAt: string | null;
  cachedMarkdown: string | null;
  needsSignIn?: boolean;
};

export type WorkProductSourcedTabConfig = {
  kind: WorkProductPromptKind;
  title: string;
  apiPath: string;
  savedContentKey: SavedDataKey;
  noSubstantiveMessage: string;
  emptyOutputMessage: string;
  includeCompanyName?: boolean;
};

export function WorkProductSourcedAnalysisTab({
  ticker,
  companyName,
  config,
}: {
  ticker: string;
  companyName?: string;
  config: WorkProductSourcedTabConfig;
}) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const { ready: prefsReady } = useUserPreferences();

  const [data, setData] = useState<SourceGetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);

  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  const [builtPrompt, setBuiltPrompt] = useState<{
    systemPrompt: string;
    userPrompt: string;
    copyPrompt: string;
    systemChars: number;
    userChars: number;
    retrievalUsed: boolean;
  } | null>(null);
  const [lastPackFingerprint, setLastPackFingerprint] = useState<string | null>(null);
  const [lastDocumentRows, setLastDocumentRows] = useState<LmeDocumentPackedRow[] | null>(null);
  const [lastPackingStats, setLastPackingStats] = useState<
    Pick<LmeRunPackingStats, "packedPartsCharSum" | "bundleCharCap" | "retrievalUsed" | "retrievalPack"> | null
  >(null);
  const [lastBuildCache, setLastBuildCache] = useState<WorkProductContextBuildCache | null>(null);
  const [promptPanelOpen, setPromptPanelOpen] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setError(null);
    setRefreshProgress(null);
    try {
      await applyWorkProductIngestPending(config.kind, safeTicker);
      const stopPoll = pollWorkProductSourceProgress(config.kind, safeTicker, (progress) => {
        setRefreshProgress(formatWorkProductSourceProgressLine(progress));
      });
      try {
        const res = await fetch(`${config.apiPath}/${encodeURIComponent(safeTicker)}`);
        const body = (await res.json()) as SourceGetResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load sources");
        setData(body);
        if (body.cachedMarkdown?.trim()) {
          setSavedContent(body.cachedMarkdown);
          setIsEditing(false);
        }
      } finally {
        stopPoll();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setRefreshProgress(null);
      setLoading(false);
    }
  }, [safeTicker, config.apiPath, config.kind]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, config.savedContentKey);
      if (!cancelled && loaded.trim()) {
        setSavedContent(loaded);
        setIsEditing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker, config.savedContentKey]);

  useEffect(() => {
    setBuiltPrompt(null);
    setLastPackFingerprint(null);
    setLastDocumentRows(null);
    setLastPackingStats(null);
    setPromptPanelOpen(false);
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, data?.currentFingerprint]);

  useEffect(() => {
    if (!safeTicker) {
      setLastBuildCache(null);
      return;
    }
    const cached = readWorkProductContextBuildCache(config.kind, safeTicker);
    if (cached && data?.currentFingerprint && cached.fingerprint === data.currentFingerprint) {
      setLastBuildCache(cached);
      setLastDocumentRows(cached.documentRows);
      setLastPackFingerprint(cached.fingerprint);
      setLastPackingStats(cached.packingStats ?? null);
    } else if (cached && data?.currentFingerprint && cached.fingerprint !== data.currentFingerprint) {
      setLastBuildCache(null);
      setLastDocumentRows(null);
      setLastPackFingerprint(null);
      setLastPackingStats(null);
    }
  }, [safeTicker, config.kind, data?.currentFingerprint]);

  async function buildContextWindow() {
    if (!safeTicker) return;
    setBuilding(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await fetch(
        `/api/work-product-prompt/${encodeURIComponent(config.kind)}/${encodeURIComponent(safeTicker)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyName: config.includeCompanyName ? companyName?.trim() ?? "" : "",
          }),
        }
      );
      const body = (await res.json()) as {
        ok?: boolean;
        error?: string;
        systemPrompt?: string;
        userPrompt?: string;
        copyPrompt?: string;
        systemChars?: number;
        userChars?: number;
        retrievalUsed?: boolean;
        sourceFingerprint?: string;
        packingStats?: LmeRunPackingStats;
      };
      if (!res.ok || !body.ok) throw new Error(body.error ?? "Failed to build context window");
      const fp = body.sourceFingerprint ?? data?.currentFingerprint ?? "";
      setBuiltPrompt({
        systemPrompt: body.systemPrompt ?? "",
        userPrompt: body.userPrompt ?? "",
        copyPrompt: body.copyPrompt ?? "",
        systemChars: body.systemChars ?? 0,
        userChars: body.userChars ?? 0,
        retrievalUsed: body.retrievalUsed === true,
      });
      setLastPackFingerprint(fp || null);
      setLastDocumentRows(body.packingStats?.documentRows ?? null);
      setLastPackingStats(
        body.packingStats
          ? {
              packedPartsCharSum: body.packingStats.packedPartsCharSum,
              bundleCharCap: body.packingStats.bundleCharCap,
              retrievalUsed: body.packingStats.retrievalUsed,
              retrievalPack: body.packingStats.retrievalPack,
            }
          : null
      );
      if (fp) {
        const cache: WorkProductContextBuildCache = {
          fingerprint: fp,
          builtAt: new Date().toISOString(),
          retrievalUsed: body.retrievalUsed === true,
          documentRows: body.packingStats?.documentRows ?? [],
          packingStats: body.packingStats
            ? {
                packedPartsCharSum: body.packingStats.packedPartsCharSum,
                bundleCharCap: body.packingStats.bundleCharCap,
                retrievalUsed: body.packingStats.retrievalUsed,
                retrievalPack: body.packingStats.retrievalPack,
              }
            : undefined,
        };
        setLastBuildCache(cache);
        writeWorkProductContextBuildCache(config.kind, safeTicker, cache);
      }
      setPromptPanelOpen(true);
      setStatusMessage("Context window ready — use step 3 to run through AI.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to build context window");
    } finally {
      setBuilding(false);
    }
  }

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    const ok = await saveToServer(safeTicker, config.savedContentKey, trimmed);
    if (!ok) {
      setError("Could not save response.");
      return;
    }
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
    setStatusMessage("Response saved.");
  }

  const copyPrompt = builtPrompt?.copyPrompt ?? "";

  async function copyToClipboard() {
    if (!copyPrompt) return;
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(copyPrompt);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
    }
  }

  function openInClaude() {
    if (!copyPrompt) return;
    void openClaudeWithClipboard(copyPrompt, setStatusMessage, setClipboardFailed);
  }

  function openInChatGPT() {
    if (!copyPrompt) return;
    void openChatGptWithClipboard(copyPrompt, setStatusMessage, setClipboardFailed);
  }

  function openInDeepSeek() {
    if (!copyPrompt) return;
    openDeepSeekWithClipboard(copyPrompt, setStatusMessage, setClipboardFailed);
  }

  function openInGemini() {
    if (!copyPrompt) return;
    openGeminiWithClipboard(copyPrompt, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title={config.title}>
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const busy = loading || building;
  const hasMainContent = savedContent.trim().length > 0;
  const activeDocumentRows =
    lastPackFingerprint && lastPackFingerprint === data?.currentFingerprint ? lastDocumentRows : null;
  const packedTotal = sumDocumentPackedChars(activeDocumentRows);
  const contextSummary = formatWorkProductContextBuildSummary(lastBuildCache, packedTotal);

  const sourceToolbar = (
    <WorkProductStepToolbar
      needsSignIn={needsSignIn}
      refreshLoading={loading}
      refreshProgressDetail={refreshProgress}
      refreshDisabled={busy || !prefsReady}
      onRefresh={() => void load()}
      buildLoading={building}
      buildDisabled={busy || !prefsReady || !data?.hasSubstantiveText || needsSignIn}
      onBuild={() => void buildContextWindow()}
      buildTitle={
        building
          ? "Assembling system instructions and packed sources…"
          : data?.hasSubstantiveText
            ? "Assemble the full prompt with packed sources"
            : "Complete step 1 and ensure saved sources are available"
      }
      runDisabled={!builtPrompt}
      onRunThroughAi={() => setPromptPanelOpen(true)}
      error={error}
      warning={
        data?.cacheStale && data.cachedMarkdown ? (
          <p className="text-[10px]" style={{ color: "var(--warn)" }}>
            Sources changed since last run — rebuild the context window.
          </p>
        ) : null
      }
    >
      <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }}>
        <summary className="cursor-pointer px-3 py-2 font-medium" style={{ color: "var(--muted2)" }}>
          {data
            ? activeDocumentRows
              ? `Source inventory (${data.sourceInventory.length} blocks, ${data.totalChars.toLocaleString()} available · ${packedTotal.toLocaleString()} in context)`
              : `Source inventory (${data.sourceInventory.length} blocks, ${data.totalChars.toLocaleString()} chars)`
            : "Source inventory"}
        </summary>
        <SourceInventoryBody
          data={data}
          loading={loading || !prefsReady}
          noSubstantiveMessage={config.noSubstantiveMessage}
          needsSignIn={needsSignIn}
          documentRows={activeDocumentRows}
          contextSummary={contextSummary}
        />
      </details>
      <WorkProductIngestSourcePicker
        kind={config.kind}
        ticker={safeTicker}
        needsSignIn={needsSignIn}
        refreshKey={data?.currentFingerprint}
      />
    </WorkProductStepToolbar>
  );

  const promptPanel = (
    <>
      <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
        {OPEN_IN_EXTERNAL_AI_FULL_LINE}
      </p>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Prompt
      </div>
      {builtPrompt ? (
        <>
          <p className="text-[10px] mb-2" style={{ color: "var(--muted)" }}>
            System {builtPrompt.systemChars.toLocaleString()} chars · User {builtPrompt.userChars.toLocaleString()} chars
            {builtPrompt.retrievalUsed ? " · retrieval-ranked pack" : " · sequential pack (no embedding retrieval)"}
          </p>
          {!builtPrompt.retrievalUsed ? (
            <p className="text-[10px] mb-2" style={{ color: "var(--warn)" }}>
              Embedding retrieval did not run — large added documents may consume up to the per-source character cap
              instead of ranked excerpts. Add an OpenAI or Gemini key (Settings) and rebuild, or remove credit agreements
              from KPI extras (use LME instead).
            </p>
          ) : null}
          <div
            className="rounded border p-3 text-xs max-h-[min(55vh,24rem)] overflow-y-auto whitespace-pre-wrap mb-3"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
          >
            {builtPrompt.copyPrompt}
          </div>
        </>
      ) : (
        <div
          className="rounded border p-3 text-xs mb-3 min-h-[4rem]"
          style={{ borderColor: "var(--border2)", color: "var(--muted)", background: "var(--card)" }}
        >
          Complete <strong>step 2 — Build context window</strong> to assemble the full prompt (system instructions +
          packed sources) here.
        </div>
      )}
      <div className="tab-prompt-ai-actions-grid mb-2">
        <button
          type="button"
          onClick={openInClaude}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          Open in Claude
        </button>
        <button
          type="button"
          onClick={openInChatGPT}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
        >
          Open in ChatGPT
        </button>
        <button
          type="button"
          onClick={openInGemini}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
        >
          Open in Gemini
        </button>
        <button
          type="button"
          onClick={openInDeepSeek}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn"
          style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
        >
          Open in DeepSeek
        </button>
        <button
          type="button"
          onClick={() => void copyToClipboard()}
          disabled={!copyPrompt}
          className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          Copy prompt
        </button>
      </div>
      {builtPrompt ? (
        <TabPromptApiButtons
          userPrompt={builtPrompt.userPrompt}
          systemPrompt={builtPrompt.systemPrompt}
          workProductKind={config.kind}
          onResult={(text) => {
            setSavedContent(text);
            setIsEditing(false);
            setEditDraft("");
            setClipboardFailed(false);
            setStatusMessage("API response received — review and save in the main area if needed.");
          }}
          persistAfterResult={async (text) => {
            const trimmed = text.trim();
            if (!safeTicker) return;
            const ok = await saveToServer(safeTicker, config.savedContentKey, trimmed);
            if (!ok) throw new Error("Could not save response.");
            setSavedContent(trimmed);
            setIsEditing(false);
            setEditDraft("");
            setStatusMessage("Response saved.");
            await load();
          }}
          className="mt-3 border-t border-[var(--border2)] pt-3"
        />
      ) : null}
      {statusMessage ? (
        <p className="text-xs mb-1 mt-2" style={{ color: "var(--muted2)" }}>
          {statusMessage}
        </p>
      ) : null}
      {clipboardFailed && copyPrompt ? (
        <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
          Select the prompt above and copy manually (Ctrl+C / Cmd+C).
        </p>
      ) : null}
    </>
  );

  return (
    <Card title={`${config.title} — ${safeTicker}`}>
      <TabPromptSlideOutShell
        hasMainContent={hasMainContent}
        hasPromptContent={!!builtPrompt}
        promptPanelOpen={promptPanelOpen}
        onPromptPanelOpenChange={setPromptPanelOpen}
        toolbarAlign="start"
        toolbar={sourceToolbar}
        main={
          <SavedResponseExpandableShell
            className={SAVED_RESPONSE_SHELL_CLASS}
            ticker={safeTicker}
            linkSourceText={isEditing ? editDraft : savedContent}
          >
            {isEditing ? (
              <>
                <RichPasteTextarea
                  value={editDraft}
                  onChange={setEditDraft}
                  placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek response here, then click Save."
                  className={SAVED_RESPONSE_EDIT_CLASS}
                  style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                />
                <button
                  type="button"
                  onClick={() => void handleSaveResponse()}
                  className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                >
                  Save
                </button>
              </>
            ) : (
              <>
                <div
                  className={SAVED_RESPONSE_VIEW_CLASS}
                  style={{ color: "var(--text)" }}
                >
                  {savedContent ? (
                    <SavedRichText content={savedContent} ticker={safeTicker} />
                  ) : (
                    <span style={{ color: "var(--muted)" }}>{config.emptyOutputMessage}</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setEditDraft(savedContent);
                    setIsEditing(true);
                  }}
                  className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                >
                  Replace / Edit
                </button>
              </>
            )}
          </SavedResponseExpandableShell>
        }
        prompt={promptPanel}
      />
    </Card>
  );
}

function SourceInventoryBody({
  data,
  loading,
  noSubstantiveMessage,
  needsSignIn,
  documentRows,
  contextSummary,
}: {
  data: SourceGetResponse | null;
  loading: boolean;
  noSubstantiveMessage: string;
  needsSignIn: boolean;
  documentRows?: LmeDocumentPackedRow[] | null;
  contextSummary?: string | null;
}) {
  if (loading && !data) {
    return (
      <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
        Scanning sources…
      </p>
    );
  }
  if (!data) {
    return (
      <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
        Source list will appear after the first refresh.
      </p>
    );
  }
  return (
    <WorkProductSourceInventoryTable
      rows={data.sourceInventory}
      documentRows={documentRows}
      contextSummary={contextSummary}
      buildPendingHint={
        data.hasSubstantiveText && !documentRows?.length && !needsSignIn ? (
          <p className="px-3 py-2 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
            Complete <strong>step 2 — Build context window</strong> to see how much of each source is included and which
            chunks were selected.
          </p>
        ) : null
      }
      emptyHint={
        !data.hasSubstantiveText && !needsSignIn ? (
          <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
            {noSubstantiveMessage}
          </p>
        ) : null
      }
    />
  );
}
