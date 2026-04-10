"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { SUBSIDIARY_LIST_PROMPT_TEMPLATE } from "@/data/subsidiary-list-prompt";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { SubsidiaryListExcelFileBox } from "@/components/SubsidiaryListExcelFileBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openGeminiWithClipboard, CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

export function CompanySubsidiaryListTab({ ticker }: { ticker: string }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [isSavedResponseCollapsed, setIsSavedResponseCollapsed] = useState(false);
  const [isExcelFileCollapsed, setIsExcelFileCollapsed] = useState(false);

  const safeTicker = ticker?.trim() ?? "";
  const { template: subsidiaryListTemplate } = usePromptTemplateOverride(
    "subsidiary-list",
    SUBSIDIARY_LIST_PROMPT_TEMPLATE
  );
  const prompt = useMemo(
    () => (safeTicker ? subsidiaryListTemplate.replace(/\{\{TICKER\}\}/g, safeTicker) : ""),
    [subsidiaryListTemplate, safeTicker]
  );

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "subsidiary-list");
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
    await saveToServer(safeTicker, "subsidiary-list", trimmed);
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
    const prefillUrl = `${CLAUDE_NEW_CHAT_BASE}?q=${encodeURIComponent(prompt)}`;
    window.open(prefillUrl, "_blank", "noopener,noreferrer");
    try {
      navigator.clipboard.writeText(prompt).then(
        () =>
          setStatusMessage(
            "Claude opened. Paste the prompt if it did not prefill; attach Exhibit 21 or other filings in the chat if you use them."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened. Paste the prompt manually; attach any filing excerpts you rely on.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened. Paste the prompt manually.");
    }
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed, (wasShortened, copyFailed) => {
      if (copyFailed) {
        return wasShortened
          ? "ChatGPT opened (short link). Copy failed — paste from OREO; attach filing excerpts you rely on."
          : "ChatGPT opened. Paste the prompt manually; attach any filing excerpts you rely on.";
      }
      return wasShortened
        ? "ChatGPT opened. The URL used a paste-first outline; FULL prompt copied — paste it in, then attach Exhibit 21 or other filings if you use them."
        : "ChatGPT opened. Paste the prompt if it did not prefill; attach Exhibit 21 or other filings if you use them.";
    });
  }

  function openInDeepSeek() {
    if (!prompt) return;
    void openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed, (wasShortened, copyFailed) => {
      if (copyFailed) {
        return wasShortened
          ? "DeepSeek opened (short link). Copy failed — paste from OREO; attach filing excerpts you rely on."
          : "DeepSeek opened. Paste the prompt manually; attach any filing excerpts you rely on.";
      }
      return wasShortened
        ? "DeepSeek opened. The URL used a paste-first outline; FULL prompt copied — paste it in, then attach Exhibit 21 or other filings if you use them."
        : "DeepSeek opened. Paste the prompt if it did not prefill; attach Exhibit 21 or other filings if you use them.";
    });
  }

  function openInGemini() {
    if (!prompt) return;
    void openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed, (wasShortened, copyFailed) => {
      if (copyFailed) {
        return wasShortened
          ? "Gemini opened (short link). Copy failed — paste from OREO; attach filing excerpts you rely on."
          : "Gemini opened. Paste the prompt manually; attach any filing excerpts you rely on.";
      }
      return wasShortened
        ? "Gemini opened. The URL used a paste-first outline; FULL prompt copied — paste it in, then attach Exhibit 21 or other filings if you use them."
        : "Gemini opened. Paste the prompt if it did not prefill; attach Exhibit 21 or other filings if you use them.";
    });
  }

  if (!safeTicker) {
    return (
      <Card title="Subsidiary List">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to build the subsidiary list prompt, save responses, and upload Excel.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card title={`Subsidiary List �?${safeTicker}`}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Same layout as Org Chart: save the model&apos;s answer, upload a working subsidiary-list Excel file (.xlsx)
          stored under this tab only, and use the prompt in Claude, ChatGPT, Gemini, or DeepSeek. This tab has no fixed sample images—attach
          Exhibit 21, debt exhibits, or other files in your AI session when helpful.
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
                    placeholder="Paste your Claude, ChatGPT, Gemini, or DeepSeek response here (tables, lists, notes), then click Save."
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
            <div
              className={`w-full flex-shrink-0 ${isSavedResponseCollapsed ? "lg:flex-1" : "lg:w-[420px]"}`}
            >
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
              <SubsidiaryListExcelFileBox ticker={safeTicker} />
            </div>
          )}

          <div className="flex w-full flex-col lg:w-80 flex-shrink-0 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                Reference materials
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                No bundled sample images for this tab. In Claude, ChatGPT, Gemini, or DeepSeek, attach the latest 10-K Exhibit 21, relevant
                10-Q updates, debt or guarantor exhibits, or your own spreadsheets alongside the prompt when useful.
              </p>
            </div>

            <div>
              <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
                Prompt. Open in AI; copy also attaches to clipboard. {CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES}
              </p>
              <PromptTemplateBox
                tabId="subsidiary-list"
                defaultTemplate={SUBSIDIARY_LIST_PROMPT_TEMPLATE}
                resolve={(tpl) => (safeTicker ? tpl.replace(/\{\{TICKER\}\}/g, safeTicker) : "")}
                className="mb-3"
              />
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
                  onClick={openInDeepSeek}
                  className="tab-prompt-ai-action-btn"
                  style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
                >
                  Open in DeepSeek
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
                onResult={() => {
                  setClipboardFailed(false);
                }}
                persistAfterResult={async (text) => {
                  const trimmed = text.trim();
                  if (!safeTicker) return;
                  const ok = await saveToServer(safeTicker, "subsidiary-list", trimmed);
                  if (!ok) throw new Error("Could not save response.");
                  setSavedContent(trimmed);
                  setIsEditing(false);
                  setEditDraft("");
                  setStatusMessage("Response saved.");
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
      </Card>
    </div>
  );
}
