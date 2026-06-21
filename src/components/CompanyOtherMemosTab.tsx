"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import type { LmeDocumentPackedRow } from "@/lib/lme-sources";
import {
  OTHER_MEMO_CONFIGS,
  type OtherMemoTabId,
} from "@/data/other-memos-config";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
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
  needsSignIn?: boolean;
};

type BuiltPrompt = {
  systemPrompt: string;
  userPrompt: string;
  copyPrompt: string;
  systemChars: number;
  userChars: number;
  retrievalUsed: boolean;
};

type BuiltPromptCacheEntry = {
  fingerprint: string;
  prompt: BuiltPrompt;
  documentRows?: LmeDocumentPackedRow[];
  buildCache?: WorkProductContextBuildCache;
};

export function CompanyOtherMemosTab({
  ticker,
  companyName,
  activeMemoTabId,
}: {
  ticker: string;
  companyName?: string;
  activeMemoTabId: OtherMemoTabId;
}) {
  const config = OTHER_MEMO_CONFIGS[activeMemoTabId];
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

  const [builtByKind, setBuiltByKind] = useState<Partial<Record<WorkProductPromptKind, BuiltPromptCacheEntry>>>({});
  const [promptPanelOpen, setPromptPanelOpen] = useState(false);
  const [refreshProgress, setRefreshProgress] = useState<string | null>(null);

  const builtPrompt = useMemo(() => {
    const fp = data?.currentFingerprint ?? "";
    const entry = builtByKind[config.kind];
    if (!fp || !entry || entry.fingerprint !== fp) return null;
    return entry.prompt;
  }, [builtByKind, config.kind, data?.currentFingerprint]);

  const activeDocumentRows = useMemo(() => {
    const fp = data?.currentFingerprint ?? "";
    const entry = builtByKind[config.kind];
    if (!fp || !entry || entry.fingerprint !== fp) return null;
    return entry.documentRows ?? null;
  }, [builtByKind, config.kind, data?.currentFingerprint]);

  const activeBuildCache = useMemo(() => {
    const fp = data?.currentFingerprint ?? "";
    const entry = builtByKind[config.kind];
    if (!fp || !entry || entry.fingerprint !== fp) return null;
    return entry.buildCache ?? null;
  }, [builtByKind, config.kind, data?.currentFingerprint]);

  const contextSummary = formatWorkProductContextBuildSummary(
    activeBuildCache,
    sumDocumentPackedChars(activeDocumentRows)
  );

  useEffect(() => {
    if (!safeTicker || !data?.currentFingerprint) return;
    const cached = readWorkProductContextBuildCache(config.kind, safeTicker);
    if (!cached || cached.fingerprint !== data.currentFingerprint) return;
    setBuiltByKind((prev) => {
      const existing = prev[config.kind];
      if (existing?.fingerprint === cached.fingerprint && existing.documentRows?.length) return prev;
      return {
        ...prev,
        [config.kind]: {
          fingerprint: cached.fingerprint,
          prompt: existing?.prompt ?? {
            systemPrompt: "",
            userPrompt: "",
            copyPrompt: "",
            systemChars: 0,
            userChars: 0,
            retrievalUsed: cached.retrievalUsed,
          },
          documentRows: cached.documentRows,
          buildCache: cached,
        },
      };
    });
  }, [safeTicker, config.kind, data?.currentFingerprint]);

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
        const res = await fetch(
          `/api/creative-workspace/${encodeURIComponent(config.kind)}/${encodeURIComponent(safeTicker)}`
        );
        const body = (await res.json()) as SourceGetResponse & { error?: string };
        if (!res.ok) throw new Error(body.error ?? "Failed to load sources");
        setData(body);
      } finally {
        stopPoll();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setRefreshProgress(null);
      setLoading(false);
    }
  }, [safeTicker, config.kind]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, config.savedContentKey);
      if (!cancelled) {
        if (loaded.trim()) {
          setSavedContent(loaded);
          setIsEditing(false);
        } else {
          setSavedContent("");
          setIsEditing(true);
          setEditDraft("");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker, config.savedContentKey]);

  useEffect(() => {
    setBuiltByKind({});
    setPromptPanelOpen(false);
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, data?.currentFingerprint]);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [activeMemoTabId]);

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
          body: JSON.stringify({ companyName: companyName?.trim() ?? "" }),
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
      const prompt: BuiltPrompt = {
        systemPrompt: body.systemPrompt ?? "",
        userPrompt: body.userPrompt ?? "",
        copyPrompt: body.copyPrompt ?? "",
        systemChars: body.systemChars ?? 0,
        userChars: body.userChars ?? 0,
        retrievalUsed: body.retrievalUsed === true,
      };
      const buildCache: WorkProductContextBuildCache = {
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
      writeWorkProductContextBuildCache(config.kind, safeTicker, buildCache);
      setBuiltByKind((prev) => ({
        ...prev,
        [config.kind]: {
          fingerprint: fp,
          prompt,
          documentRows: body.packingStats?.documentRows,
          buildCache,
        },
      }));
      setPromptPanelOpen(true);
      setStatusMessage(`Context window ready for ${config.title} — use step 3 to run through AI.`);
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
      <Card title="For the Hallucinators --->">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const busy = loading || building;
  const hasMainContent = savedContent.trim().length > 0;
  const packedTotal = sumDocumentPackedChars(activeDocumentRows);

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
        data?.hasSubstantiveText
          ? `Assemble the ${config.title} prompt with packed sources`
          : "Complete step 1 and ensure saved sources are available"
      }
      runDisabled={!builtPrompt}
      onRunThroughAi={() => setPromptPanelOpen(true)}
      error={error}
    >
      <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }}>
        <summary className="cursor-pointer px-3 py-2 font-medium" style={{ color: "var(--muted2)" }}>
          {data
            ? activeDocumentRows
              ? `Shared source inventory (${data.sourceInventory.length} blocks, ${data.totalChars.toLocaleString()} available · ${packedTotal.toLocaleString()} in context)`
              : `Shared source inventory (${data.sourceInventory.length} blocks, ${data.totalChars.toLocaleString()} chars)`
            : "Shared source inventory"}
        </summary>
        <SharedSourceInventoryBody
          data={data}
          loading={loading || !prefsReady}
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
        Prompt — {config.title}
      </div>
      {builtPrompt ? (
        <>
          <p className="text-[10px] mb-2" style={{ color: "var(--muted)" }}>
            System {builtPrompt.systemChars.toLocaleString()} chars · User {builtPrompt.userChars.toLocaleString()} chars
            {builtPrompt.retrievalUsed ? " · retrieval-ranked pack" : ""}
          </p>
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
          Complete <strong>step 2 — Build context window</strong> to assemble the full prompt here.
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
    <Card title={`For the Hallucinators ---> — ${config.title} — ${safeTicker}`}>
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

function SharedSourceInventoryBody({
  data,
  loading,
  needsSignIn,
  documentRows,
  contextSummary,
}: {
  data: SourceGetResponse | null;
  loading: boolean;
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
            No substantive sources yet. Save at least one Work Product tab output and/or an earnings transcript from Period
            Financials.
          </p>
        ) : null
      }
    />
  );
}
