"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { AiCreditDeckTemplateFileBox } from "@/components/AiCreditDeckTemplateFileBox";
import { AI_CREDIT_DECK_PROMPT_TEMPLATE } from "@/data/ai-credit-deck-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openGeminiWithClipboard, CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";

export function CompanyAiCreditDeckTab({ ticker }: { ticker: string }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);
  const [isSavedResponseCollapsed, setIsSavedResponseCollapsed] = useState(false);
  const [isTemplateFileCollapsed, setIsTemplateFileCollapsed] = useState(false);

  const safeTicker = ticker?.trim() ?? "";
  const prompt = useMemo(() => {
    if (!safeTicker) return "";
    return AI_CREDIT_DECK_PROMPT_TEMPLATE.replace(/\{\{TICKER\}\}/g, safeTicker);
  }, [safeTicker]);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "ai-credit-deck");
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
    await saveToServer(safeTicker, "ai-credit-deck", trimmed);
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
    void openClaudeWithClipboard(prompt, setStatusMessage, setClipboardFailed, (copyFailed) => {
      if (copyFailed) {
        return "Claude opened. Upload your template and paste the prompt manually.";
      }
      return "Claude opened. Prompt copied — paste into the chat, upload your deck template and documents, then press Enter.";
    });
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, clearFailed) => {
      if (clearFailed) {
        return "ChatGPT opened. Upload your template and paste the prompt manually.";
      }
      return "ChatGPT opened. Clipboard cleared — use Copy prompt, paste, upload your deck template and documents, then press Enter.";
    });
  }

  function openInDeepSeek() {
    if (!prompt) return;
    void openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "DeepSeek opened. Upload your template and paste the prompt manually.";
      }
      return "DeepSeek opened. Prompt copied — paste into the chat, upload your deck template and documents, then press Enter.";
    });
  }

  function openInGemini() {
    if (!prompt) return;
    void openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "Gemini opened. Upload your template and paste the prompt manually.";
      }
      return "Gemini opened. Prompt copied — paste into the chat, upload your deck template and documents, then press Enter.";
    });
  }

  if (!safeTicker) {
    return (
      <Card title="AI Credit Deck">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to build the AI Credit Deck prompt and save your generated slide content.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card title={`AI Credit Deck �?${safeTicker}`}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Same workflow as Org Chart: upload your template file, run the prompt in Claude, ChatGPT, Gemini, or DeepSeek, and save the output here.
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
                    placeholder="Paste your slide-by-slide AI response here, then click Save."
                    className={`min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`}
                    style={{ borderColor: "var(--border2)", color: "var(--text)" }}
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
                    {savedContent ? <SavedRichText content={savedContent} ticker={safeTicker} /> : <span style={{ color: "var(--muted)" }}>No saved response yet.</span>}
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

          {isTemplateFileCollapsed ? (
            <div className="flex w-full justify-start lg:w-[44px] lg:flex-none">
              <button
                type="button"
                onClick={() => setIsTemplateFileCollapsed(false)}
                className="mt-1 rounded border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
              >
                Show Template
              </button>
            </div>
          ) : (
            <div className={`w-full flex-shrink-0 ${isSavedResponseCollapsed ? "lg:flex-1" : "lg:w-[420px]"}`}>
              <div className="mb-2 flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => setIsTemplateFileCollapsed(true)}
                  className="rounded border px-2 py-1 text-[11px] font-medium"
                  style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
                >
                  Minimize Template File
                </button>
              </div>
              <AiCreditDeckTemplateFileBox ticker={safeTicker} />
            </div>
          )}

          <div className="flex w-full flex-col lg:w-80 flex-shrink-0 gap-3">
            <div>
              <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
                Prompt for AI Credit Deck (uses your exact instructions). Open in AI; copy also goes to clipboard.{" "}
                {CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES}
              </p>
              <div
                className="rounded border p-3 mb-2 text-xs max-h-[min(40vh,320px)] overflow-y-auto whitespace-pre-wrap"
                style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
              >
                {prompt}
              </div>
              <div className="tab-prompt-ai-actions-grid mb-2">
                <button
                  type="button"
                  onClick={openInClaude}
                  className="tab-prompt-ai-action-btn"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
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
                  const ok = await saveToServer(safeTicker, "ai-credit-deck", trimmed);
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

