"use client";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE } from "@/data/business-risk-analysis-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

const SAVE_KEY = "business-risk-analysis" as const;

export function CompanyBusinessRiskAnalysisTab({
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
  const { template: promptTemplate } = usePromptTemplateOverride(
    SAVE_KEY,
    BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE
  );
  const prompt = safeTicker ? fillCompanyPromptTemplate(promptTemplate, safeTicker, companyName) : "";

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, companyName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, SAVE_KEY);
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
    await saveToServer(safeTicker, SAVE_KEY, trimmed);
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
      await navigator.clipboard.writeText(withPromptBenchmarkNotice(prompt));
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
    }
  }

  function openInClaude() {
    if (!prompt) return;
    void openClaudeWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInDeepSeek() {
    if (!prompt) return;
    openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  function openInGemini() {
    if (!prompt) return;
    openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title="Business Risk Analysis">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Business Risk Analysis - ${safeTicker}`}>
      <TabPromptSlideOutShell
        hasMainContent={savedContent.trim().length > 0}
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
                className={SAVED_RESPONSE_VIEW_CLASS}
                style={{ color: "var(--text)" }}
              >
                {savedContent ? <SavedRichText content={savedContent} ticker={safeTicker} /> : (
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
        }
        prompt={
          <>
          <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
            {OPEN_IN_EXTERNAL_AI_FULL_LINE}
          </p>
          <PromptTemplateBox
            tabId={SAVE_KEY}
            defaultTemplate={BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE}
            resolve={(tpl) =>
              safeTicker ? fillCompanyPromptTemplate(tpl, safeTicker, companyName) : ""
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
            researchSaveKey="business-risk-analysis"
            userPrompt={prompt}
            onResult={() => {
              setClipboardFailed(false);
            }}
            persistAfterResult={async (text) => {
              const trimmed = text.trim();
              if (!safeTicker) return;
              const ok = await saveToServer(safeTicker, SAVE_KEY, trimmed);
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
          </>
        }
      />
    </Card>
  );
}
