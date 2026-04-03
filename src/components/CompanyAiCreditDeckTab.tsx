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
import { openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import { openGeminiNewChatWindow, CHATGPT_META_GEMINI_LONG_URL_NOTICES } from "@/lib/gemini-open-url";
import { openMetaAiNewChatWindow } from "@/lib/meta-ai-open-url";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

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
    setStatusMessage(null);
    setClipboardFailed(false);
    const prefillUrl = `${CLAUDE_NEW_CHAT_BASE}?q=${encodeURIComponent(prompt)}`;
    window.open(prefillUrl, "_blank", "noopener,noreferrer");
    try {
      navigator.clipboard.writeText(prompt).then(
        () => setStatusMessage("Claude opened. Upload your deck template and paste documents for best results."),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened. Upload your template and paste the prompt manually.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened. Upload your template and paste the prompt manually.");
    }
  }

  function openInChatGPT() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openChatGptNewChatWindow(prompt);
    try {
      navigator.clipboard.writeText(prompt).then(
        () => {
          setClipboardFailed(false);
          setStatusMessage(
            wasShortened
              ? "ChatGPT opened. Link text was shortened to fit; FULL prompt copied — paste into ChatGPT, then upload your deck template and documents."
              : "ChatGPT opened. Upload your deck template and paste documents for best results."
          );
        },
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "ChatGPT opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
              : "ChatGPT opened. Upload your template and paste the prompt manually."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "ChatGPT opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
          : "ChatGPT opened. Upload your template and paste the prompt manually."
      );
    }
  }

  function openInMetaAI() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openMetaAiNewChatWindow(prompt);
    try {
      navigator.clipboard.writeText(prompt).then(
        () => {
          setClipboardFailed(false);
          setStatusMessage(
            wasShortened
              ? "Meta AI opened. Link text was shortened to fit; FULL prompt copied — paste into Meta AI, then upload your deck template and documents."
              : "Meta AI opened. Upload your deck template and paste documents for best results."
          );
        },
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "Meta AI opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
              : "Meta AI opened. Upload your template and paste the prompt manually."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "Meta AI opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
          : "Meta AI opened. Upload your template and paste the prompt manually."
      );
    }
  }

  function openInGemini() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openGeminiNewChatWindow(prompt);
    try {
      navigator.clipboard.writeText(prompt).then(
        () => {
          setClipboardFailed(false);
          setStatusMessage(
            wasShortened
              ? "Gemini opened. Link text was shortened to fit; FULL prompt copied — paste into Gemini, then upload your deck template and documents."
              : "Gemini opened. Upload your deck template and paste documents for best results."
          );
        },
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "Gemini opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
              : "Gemini opened. Upload your template and paste the prompt manually."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "Gemini opened (short link). Copy failed — paste the prompt from OREO, then upload your template and documents."
          : "Gemini opened. Upload your template and paste the prompt manually."
      );
    }
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
      <Card title={`AI Credit Deck — ${safeTicker}`}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Same workflow as Org Chart: upload your template file, run the prompt in Claude, ChatGPT, Gemini, or Meta AI, and save the output here.
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
                {CHATGPT_META_GEMINI_LONG_URL_NOTICES}
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
      </Card>
    </div>
  );
}

