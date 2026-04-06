"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE } from "@/data/industry-publications-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { chatGptOpenStatusMessage, openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openMetaAiWithClipboard } from "@/lib/meta-ai-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

export function CompanyIndustryPublicationsTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";
  const { template: publicationsTemplate } = usePromptTemplateOverride(
    "industry-publications",
    INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE
  );
  const prompt = safeTicker
    ? publicationsTemplate.replace(/\[COMPANY NAME\]/g, displayName).replace(/\[TICKER\]/g, safeTicker)
    : "";

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, displayName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "industry-publications");
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
    await saveToServer(safeTicker, "industry-publications", trimmed);
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
            "Claude opened in a new tab. Prompt copied to clipboard — paste into Claude if it didn't prefill."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            "Claude opened in a new tab. Prompt could not be copied — use the prompt below and paste into Claude."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        "Claude opened in a new tab. Prompt could not be copied — use the prompt below and paste into Claude."
      );
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
          setStatusMessage(chatGptOpenStatusMessage(wasShortened, false));
        },
        () => {
          setClipboardFailed(true);
          setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
    }
  }

  function openInMetaAI() {
    if (!prompt) return;
    openMetaAiWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInGemini() {
    if (!prompt) return;
    openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title="Industry Publications">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or Meta AI.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Industry Publications — ${safeTicker}`}>
      <div className="flex flex-col gap-6 lg:flex-row">
        <SavedResponseExpandableShell className="min-w-0 flex-1">
          {isEditing ? (
            <>
              <RichPasteTextarea
                value={editDraft}
                onChange={setEditDraft}
                placeholder="Paste your Claude, ChatGPT, Gemini, or Meta AI response here, then click Save."
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

        <div className="flex w-full flex-col lg:w-80 flex-shrink-0">
          <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
            {OPEN_IN_EXTERNAL_AI_FULL_LINE}
          </p>
          <PromptTemplateBox
            tabId="industry-publications"
            defaultTemplate={INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE}
            resolve={(tpl) =>
              safeTicker ? tpl.replace(/\[COMPANY NAME\]/g, displayName).replace(/\[TICKER\]/g, safeTicker) : ""
            }
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
    </Card>
  );
}
