"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import {
  fillHistoricalFinancialsPromptPlaceholders,
  HISTORICAL_FINANCIALS_PROMPT_TEMPLATE,
} from "@/data/historical-financials-prompt";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { OrgChartExcelFileBox } from "@/components/OrgChartExcelFileBox";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { chatGptOpenStatusMessage, openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import {
  CHATGPT_META_GEMINI_LONG_URL_NOTICES,
  geminiOpenStatusMessage,
  openGeminiNewChatWindow,
} from "@/lib/gemini-open-url";
import { metaAiOpenStatusMessage, openMetaAiNewChatWindow } from "@/lib/meta-ai-open-url";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

export function HistoricalFinancialsAiWorkflow({
  ticker,
  companyName,
  noOuterCard,
}: {
  ticker: string;
  companyName?: string | null;
  /** When true, render inside a parent card (e.g. Financials tab section). */
  noOuterCard?: boolean;
}) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [isSavedResponseCollapsed, setIsSavedResponseCollapsed] = useState(false);
  const [isExcelFileCollapsed, setIsExcelFileCollapsed] = useState(false);

  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";
  const prompt = useMemo(() => {
    if (!safeTicker) return "";
    return fillHistoricalFinancialsPromptPlaceholders(HISTORICAL_FINANCIALS_PROMPT_TEMPLATE, displayName, safeTicker);
  }, [safeTicker, displayName]);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, displayName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    void (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "historical-financials-prompt");
      if (!cancelled) {
        setSavedContent(loaded);
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, "historical-financials-prompt", trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  async function copyToClipboard() {
    if (!prompt) return;
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
    }
  }

  function openInClaude() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    window.open(`${CLAUDE_NEW_CHAT_BASE}?q=${encodeURIComponent(prompt)}`, "_blank", "noopener,noreferrer");
    void navigator.clipboard.writeText(prompt).then(
      () => setStatusMessage("Claude opened. Prompt copied to clipboard."),
      () => {
        setClipboardFailed(true);
        setStatusMessage("Claude opened. Paste the prompt manually if copy failed.");
      }
    );
  }

  function openInChatGPT() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openChatGptNewChatWindow(prompt);
    void navigator.clipboard.writeText(prompt).then(
      () => {
        setClipboardFailed(false);
        setStatusMessage(chatGptOpenStatusMessage(wasShortened, false));
      },
      () => {
        setClipboardFailed(true);
        setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
      }
    );
  }

  function openInMetaAI() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openMetaAiNewChatWindow(prompt);
    void navigator.clipboard.writeText(prompt).then(
      () => {
        setClipboardFailed(false);
        setStatusMessage(metaAiOpenStatusMessage(wasShortened, false));
      },
      () => {
        setClipboardFailed(true);
        setStatusMessage(metaAiOpenStatusMessage(wasShortened, true));
      }
    );
  }

  function openInGemini() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openGeminiNewChatWindow(prompt);
    void navigator.clipboard.writeText(prompt).then(
      () => {
        setClipboardFailed(false);
        setStatusMessage(geminiOpenStatusMessage(wasShortened, false));
      },
      () => {
        setClipboardFailed(true);
        setStatusMessage(geminiOpenStatusMessage(wasShortened, true));
      }
    );
  }

  const noTickerBody = (
    <p className="text-sm py-2" style={{ color: "var(--muted2)" }}>
      Select a company to fill in the forensic model prompt and save your AI response for this ticker.
    </p>
  );

  const mainBody = (
    <>
      <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
        Use the prompt in Claude, ChatGPT, Gemini, or Meta AI to draft a filing-faithful historical model (10 annual years, 20 quarters per
        the instructions). Save notes or output below and attach the per-ticker Excel workbook. Ground numbers in original filings and your
        spreadsheet—not third-party aggregators.
      </p>
      <div className="flex flex-col gap-6 lg:flex-row">
        {isSavedResponseCollapsed ? (
          <div className="flex w-full justify-start lg:w-[44px] lg:flex-none">
            <button
              type="button"
              onClick={() => setIsSavedResponseCollapsed(false)}
              className="mt-1 rounded border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
            >
              Show Saved
            </button>
          </div>
        ) : (
          <SavedResponseExpandableShell
            className="min-w-0 flex-1 gap-4 overflow-y-auto"
            headerActions={
              <button
                type="button"
                onClick={() => setIsSavedResponseCollapsed(true)}
                className="rounded border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
              >
                Minimize
              </button>
            }
            ticker={safeTicker}
            linkSourceText={isEditing ? editDraft : savedContent}
          >
            {isEditing ? (
              <>
                <RichPasteTextarea
                  value={editDraft}
                  onChange={setEditDraft}
                  placeholder="Paste your AI response (notes, caveats, sheet map, etc.), then click Save."
                  className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
                  style={{
                    borderColor: "var(--border2)",
                    color: "var(--text)",
                  }}
                />
                <button
                  type="button"
                  onClick={handleSaveResponse}
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
                    <span style={{ color: "var(--muted)" }}>No saved response yet.</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={handleReplace}
                  className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                >
                  Replace / Edit
                </button>
              </>
            )}
          </SavedResponseExpandableShell>
        )}

        {isExcelFileCollapsed ? (
          <div className="flex w-full justify-start lg:w-[44px] lg:flex-none">
            <button
              type="button"
              onClick={() => setIsExcelFileCollapsed(false)}
              className="mt-1 rounded border px-2 py-1 text-[11px] font-medium"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
            >
              Show Excel
            </button>
          </div>
        ) : (
          <div className={`w-full flex-shrink-0 ${isSavedResponseCollapsed ? "lg:flex-1" : "lg:w-[420px]"}`}>
            <div className="mb-2 flex items-center justify-end">
              <button
                type="button"
                onClick={() => setIsExcelFileCollapsed(true)}
                className="rounded border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
              >
                Minimize Excel File
              </button>
            </div>
            <OrgChartExcelFileBox
              ticker={safeTicker}
              apiBasePath="/api/historical-financials-excel"
              emptyMessage="Select a company to upload the historical financial model (.xlsx)."
              heading="Excel workbook"
              previewMaxRows={120}
              previewMaxCols={48}
            />
          </div>
        )}

        <div className="flex w-full flex-col lg:w-80 flex-shrink-0 gap-3">
          <div>
            <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
              Forensic extraction prompt (SEC / XBRL). Open in AI; copy attaches to clipboard. {CHATGPT_META_GEMINI_LONG_URL_NOTICES}
            </p>
            <div
              className="mb-2 max-h-[min(55vh,520px)] overflow-y-auto whitespace-pre-wrap rounded border p-3 text-xs"
              style={{
                borderColor: "var(--border2)",
                color: "var(--text)",
                background: "var(--card)",
              }}
            >
              {prompt}
            </div>
            <div className="tab-prompt-ai-actions-grid mb-2">
              <button
                type="button"
                onClick={openInClaude}
                className="tab-prompt-ai-action-btn"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  background: "transparent",
                }}
              >
                Open in Claude
              </button>
              <button
                type="button"
                onClick={openInChatGPT}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
              >
                Open in ChatGPT
              </button>
              <button
                type="button"
                onClick={openInGemini}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
              >
                Open in Gemini
              </button>
              <button
                type="button"
                onClick={openInMetaAI}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#0866FF", color: "#0866FF", background: "transparent" }}
              >
                Open in Meta AI
              </button>
              <button
                type="button"
                onClick={copyToClipboard}
                className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Copy prompt
              </button>
            </div>
            <TabPromptApiButtons
              userPrompt={prompt}
              onResult={(text) => {
                setEditDraft(text);
                setIsEditing(true);
                setStatusMessage("Response from API — review and click Save to store.");
                setClipboardFailed(false);
              }}
              className="mt-3 border-t border-[var(--border2)] pt-3"
            />
            {statusMessage && (
              <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
                {statusMessage}
              </p>
            )}
            {clipboardFailed && prompt && (
              <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
                Select the prompt above and copy manually (Ctrl+C / Cmd+C).
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );

  if (!safeTicker) {
    if (noOuterCard) return noTickerBody;
    return (
      <Card title="Historical Financial Statements">
        {noTickerBody}
      </Card>
    );
  }

  if (noOuterCard) {
    return <div className="space-y-4">{mainBody}</div>;
  }

  return <Card title={`Historical Financial Statements — ${safeTicker}`}>{mainBody}</Card>;
}
