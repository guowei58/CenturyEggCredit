"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { CapitalStructureExcelFileBox } from "@/components/CapitalStructureExcelFileBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";
import { CAPITAL_STRUCTURE_PROMPT_TEMPLATE, CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS } from "@/data/capital-structure-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openGeminiWithClipboard, CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";

const CAPITAL_STRUCTURE_SAMPLE_THUMBNAILS: { path: (typeof CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS)[number]; label: string; alt: string }[] =
  [
    {
      path: CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS[0],
      label: "Capital Structure sample 1",
      alt: "Reference capital structure table sample 1",
    },
    {
      path: CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS[1],
      label: "Capital Structure sample 2",
      alt: "Reference capital structure table sample 2",
    },
  ];

function linkify(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"')\]\}]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline break-all"
        style={{ color: "var(--accent)" }}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

export function CompanyCapitalStructureTab({
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

  const [isSavedResponseCollapsed, setIsSavedResponseCollapsed] = useState(false);
  const [isExcelFileCollapsed, setIsExcelFileCollapsed] = useState(false);

  const safeTicker = ticker?.trim() ?? "";
  const { template: capitalStructureTemplate } = usePromptTemplateOverride(
    "capital-structure",
    CAPITAL_STRUCTURE_PROMPT_TEMPLATE
  );
  const prompt = useMemo(() => {
    if (!safeTicker) return "";
    return capitalStructureTemplate.replace(/\{\{TICKER\}\}/g, safeTicker);
  }, [capitalStructureTemplate, safeTicker]);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "capital-structure");
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
    await saveToServer(safeTicker, "capital-structure", trimmed);
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
        return "Claude opened. Attach the reference templates and paste the prompt manually.";
      }
      return "Claude opened. Prompt copied — paste into the chat, attach the reference templates from this tab, then press Enter.";
    });
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, clearFailed) => {
      if (clearFailed) {
        return "ChatGPT opened. Attach the reference templates and paste the prompt manually.";
      }
      return "ChatGPT opened. Clipboard cleared — use Copy prompt, paste, attach the reference templates if supported, then press Enter.";
    });
  }

  function openInDeepSeek() {
    if (!prompt) return;
    void openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "DeepSeek opened. Attach the reference templates and paste the prompt manually.";
      }
      return "DeepSeek opened. Prompt copied — paste into the chat, attach the reference templates if supported, then press Enter.";
    });
  }

  function openInGemini() {
    if (!prompt) return;
    void openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "Gemini opened. Attach the reference templates and paste the prompt manually.";
      }
      return "Gemini opened. Prompt copied — paste into the chat, attach the reference templates if supported, then press Enter.";
    });
  }

  if (!safeTicker) {
    return (
      <Card title="Capital Structure">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to build the capital structure prompt and underwriting deliverable.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      <Card title={`Capital Structure �?${safeTicker}`}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Use the reference templates and prompt in Claude, ChatGPT, Gemini, or DeepSeek (vision). Save the model&apos;s answer below.
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
                    placeholder="Paste your Claude, ChatGPT, or DeepSeek response here, then click Save."
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
              <CapitalStructureExcelFileBox ticker={safeTicker} />
            </div>
          )}

          <div className="flex w-full flex-col lg:w-80 flex-shrink-0 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                Reference templates
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {CAPITAL_STRUCTURE_SAMPLE_THUMBNAILS.map(({ path, label, alt }) => (
                  <a
                    key={path}
                    href={path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded border overflow-hidden"
                    style={{ borderColor: "var(--border2)" }}
                    title={label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={path}
                      alt={alt}
                      className="w-full h-[72px] object-cover object-top bg-[var(--card2)]"
                    />
                    <div
                      className="px-1 py-0.5 text-[9px] leading-tight truncate"
                      style={{ color: "var(--muted2)", background: "var(--card)" }}
                    >
                      {label}
                    </div>
                  </a>
                ))}
              </div>
              <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
                Open each in a new tab to save, or right-click �?Save image. Attach them with your prompt if supported.
              </p>
            </div>

            <div>
              <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
                Prompt (includes numbered reference image URLs). Open in AI; copy attaches to clipboard.{" "}
                {CHATGPT_DEEPSEEK_GEMINI_LONG_URL_NOTICES}
              </p>
              <PromptTemplateBox
                tabId="capital-structure"
                defaultTemplate={CAPITAL_STRUCTURE_PROMPT_TEMPLATE}
                resolve={(tpl) => (safeTicker ? tpl.replace(/\{\{TICKER\}\}/g, safeTicker) : "")}
                className="mb-3"
              />
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
                  const ok = await saveToServer(safeTicker, "capital-structure", trimmed);
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

