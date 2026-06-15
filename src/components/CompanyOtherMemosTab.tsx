"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";

import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import {
  OTHER_MEMOS_SHARED_API_PATH,
  OTHER_MEMO_CONFIGS,
  type OtherMemoTabId,
} from "@/data/other-memos-config";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";

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

  const builtPrompt = useMemo(() => {
    const fp = data?.currentFingerprint ?? "";
    const entry = builtByKind[config.kind];
    if (!fp || !entry || entry.fingerprint !== fp) return null;
    return entry.prompt;
  }, [builtByKind, config.kind, data?.currentFingerprint]);

  const load = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${OTHER_MEMOS_SHARED_API_PATH}/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as SourceGetResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load sources");
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
      setBuiltByKind((prev) => ({
        ...prev,
        [config.kind]: { fingerprint: fp, prompt },
      }));
      setStatusMessage(`Context window ready for ${config.title}.`);
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
      <Card title="For the Dreamers">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  const needsSignIn = authStatus !== "authenticated";
  const busy = loading || building;
  const hasMainContent = savedContent.trim().length > 0;

  const sourceToolbar = (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
        {config.whatYouGet} Click <strong>Refresh sources</strong>, then <strong>Build context window</strong> to create
        the prompt blob. Open the <strong>Prompt</strong> pull tab on the right, run your AI there, and paste the answer
        back here.
      </p>
      {needsSignIn ? (
        <p className="text-xs rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
          Sign in to load saved sources, build the context window, and save responses.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy || !prefsReady}
          className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          {loading ? "Refreshing…" : "Refresh sources"}
        </button>
        <button
          type="button"
          onClick={() => void buildContextWindow()}
          disabled={busy || !prefsReady || !data?.hasSubstantiveText || needsSignIn}
          className="rounded border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          {building ? "Building…" : "Build context window"}
        </button>
      </div>
      {error ? (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      <details className="rounded border text-xs" style={{ borderColor: "var(--border2)" }}>
        <summary className="cursor-pointer px-3 py-2 font-medium" style={{ color: "var(--muted2)" }}>
          {data
            ? `Shared source inventory (${data.sourceInventory.length} blocks, ${data.totalChars.toLocaleString()} chars)`
            : "Shared source inventory"}
        </summary>
        <SharedSourceInventoryBody
          data={data}
          loading={loading || !prefsReady}
          needsSignIn={needsSignIn}
        />
      </details>
    </div>
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
          Build the context window above, then open the <strong>Prompt</strong> pull tab on the right to copy or run the
          assembled prompt.
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
    <Card title={`For the Dreamers — ${config.title} — ${safeTicker}`}>
      <TabPromptSlideOutShell
        hasMainContent={hasMainContent}
        toolbarAlign="start"
        toolbar={sourceToolbar}
        main={
          <SavedResponseExpandableShell
            className="min-w-0 flex-1"
            ticker={safeTicker}
            linkSourceText={isEditing ? editDraft : savedContent}
          >
            {isEditing ? (
              <>
                <RichPasteTextarea
                  value={editDraft}
                  onChange={setEditDraft}
                  placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek response here, then click Save."
                  className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
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
                  className={`min-h-[50vh] flex-1 overflow-y-auto rounded border border-transparent px-0 py-2 text-sm leading-relaxed lg:min-h-[60vh] lg:max-h-[65vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
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
}: {
  data: SourceGetResponse | null;
  loading: boolean;
  needsSignIn: boolean;
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
    <>
      <div
        className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-2 border-b px-3 py-1.5 text-[9px] font-semibold sm:grid-cols-[minmax(0,1fr)_6.75rem] sm:text-[10px]"
        style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
      >
        <span>Source</span>
        <span className="text-right">Chars</span>
      </div>
      <ul className="max-h-40 overflow-y-auto divide-y" style={{ borderColor: "var(--border2)" }}>
        {data.sourceInventory.map((s) => (
          <li
            key={`${s.label}-${s.key ?? ""}-${s.charsInitial}`}
            className="grid grid-cols-[minmax(0,1fr)_5.5rem] gap-x-2 px-3 py-1.5 sm:grid-cols-[minmax(0,1fr)_6.75rem]"
            style={{ color: "var(--text)" }}
          >
            <span className="min-w-0 truncate" title={s.label}>
              {s.label}
              {s.truncated ? " · truncated" : ""}
            </span>
            <span className="text-right font-mono text-[10px] tabular-nums sm:text-[11px]" style={{ color: "var(--muted)" }}>
              {s.isBinaryPlaceholder ? "—" : s.charsInitial.toLocaleString()}
            </span>
          </li>
        ))}
      </ul>
      {!data.hasSubstantiveText && !needsSignIn ? (
        <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
          No substantive sources yet. Save at least one Work Product tab output and/or an earnings transcript from Period
          Financials.
        </p>
      ) : null}
    </>
  );
}
