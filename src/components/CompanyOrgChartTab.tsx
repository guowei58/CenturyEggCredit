"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { ORG_CHART_PROMPT_TEMPLATE, ORG_CHART_SAMPLE_IMAGE_PATHS, resolveOrgChartTemplate } from "@/data/org-chart-prompt";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { OrgChartExcelFileBox } from "@/components/OrgChartExcelFileBox";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

const ORG_CHART_SAMPLE_THUMBNAILS: { path: (typeof ORG_CHART_SAMPLE_IMAGE_PATHS)[number]; label: string; alt: string }[] = [
  {
    path: ORG_CHART_SAMPLE_IMAGE_PATHS[0],
    label: "Lumen-style",
    alt: "Credit org chart reference: black, yellow financing, green operating entities",
  },
  {
    path: ORG_CHART_SAMPLE_IMAGE_PATHS[1],
    label: "EchoStar / DISH-style",
    alt: "Credit org chart reference: multi-color branches, spectrum and operating labels",
  },
  {
    path: ORG_CHART_SAMPLE_IMAGE_PATHS[2],
    label: "Optimum-style",
    alt: "Credit org chart reference: restricted group vs unrestricted subsidiaries",
  },
];
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import { openGeminiNewChatWindow, CHATGPT_META_GEMINI_LONG_URL_NOTICES } from "@/lib/gemini-open-url";
import { openMetaAiNewChatWindow } from "@/lib/meta-ai-open-url";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

export function CompanyOrgChartTab({
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

  const [appOrigin, setAppOrigin] = useState("");

  useEffect(() => {
    setAppOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  const { template: orgChartTemplate } = usePromptTemplateOverride("org-chart", ORG_CHART_PROMPT_TEMPLATE);
  const prompt = useMemo(
    () =>
      safeTicker
        ? resolveOrgChartTemplate(orgChartTemplate, { ticker: safeTicker, companyName, appOrigin })
        : "",
    [orgChartTemplate, safeTicker, companyName, appOrigin]
  );

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, companyName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "org-chart-prompt");
      if (!cancelled) {
        setSavedContent(loaded);
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => { cancelled = true; };
  }, [safeTicker]);

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, "org-chart-prompt", trimmed);
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
            "Claude opened. Attach all three sample images from this tab together with the prompt if the model supports images."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened. Attach the three sample images and paste the prompt if copy failed.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened. Attach the three sample images and paste the prompt manually.");
    }
  }

  function openInChatGPT() {
    if (!prompt) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openChatGptNewChatWindow(prompt);
    try {
      navigator.clipboard.writeText(prompt).then(
        () =>
          setStatusMessage(
            wasShortened
              ? "ChatGPT opened. Link was shortened; FULL prompt copied — paste it in, then attach all three sample images if the model supports images."
              : "ChatGPT opened. Attach all three sample images in the chat if the model supports images."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "ChatGPT opened (short link). Copy failed — paste from OREO and attach the three sample images."
              : "ChatGPT opened. Attach the three sample images and paste the prompt if copy failed."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "ChatGPT opened (short link). Copy failed — paste from OREO and attach the three sample images."
          : "ChatGPT opened. Attach the three sample images and paste the prompt manually."
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
        () =>
          setStatusMessage(
            wasShortened
              ? "Meta AI opened. Link was shortened; FULL prompt copied — paste it in, then attach all three sample images if the model supports images."
              : "Meta AI opened. Attach all three sample images in the chat if the model supports images."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "Meta AI opened (short link). Copy failed — paste from OREO and attach the three sample images."
              : "Meta AI opened. Attach the three sample images and paste the prompt if copy failed."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "Meta AI opened (short link). Copy failed — paste from OREO and attach the three sample images."
          : "Meta AI opened. Attach the three sample images and paste the prompt manually."
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
        () =>
          setStatusMessage(
            wasShortened
              ? "Gemini opened. Link was shortened; FULL prompt copied — paste it in, then attach all three sample images if the model supports images."
              : "Gemini opened. Attach all three sample images in the chat if the model supports images."
          ),
        () => {
          setClipboardFailed(true);
          setStatusMessage(
            wasShortened
              ? "Gemini opened (short link). Copy failed — paste from OREO and attach the three sample images."
              : "Gemini opened. Attach the three sample images and paste the prompt if copy failed."
          );
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(
        wasShortened
          ? "Gemini opened (short link). Copy failed — paste from OREO and attach the three sample images."
          : "Gemini opened. Attach the three sample images and paste the prompt manually."
      );
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Org Chart">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to build the org chart prompt.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Org Chart — ${safeTicker}`}>
        <p className="text-xs mb-4 leading-relaxed" style={{ color: "var(--muted2)" }}>
          Use the three reference screenshots and prompt in Claude, ChatGPT, Gemini, or Meta AI (vision). Save the model&apos;s answer below.
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
                    placeholder="Paste your Claude, ChatGPT, Gemini, or Meta AI response here (summary, entity list, Mermaid/DOT, etc.), then click Save."
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
              <OrgChartExcelFileBox ticker={safeTicker} />
            </div>
          )}

          <div className="flex w-full flex-col lg:w-80 flex-shrink-0 gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                Sample templates (attach all three in AI)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {ORG_CHART_SAMPLE_THUMBNAILS.map(({ path, label, alt }) => (
                  <a
                    key={path}
                    href={path}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block rounded border overflow-hidden"
                    style={{ borderColor: "var(--border2)" }}
                    title={label}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- static public assets */}
                    <img
                      src={path}
                      alt={alt}
                      className="w-full h-[72px] object-cover object-top bg-[var(--card2)]"
                    />
                    <div className="px-1 py-0.5 text-[9px] leading-tight truncate" style={{ color: "var(--muted2)", background: "var(--card)" }}>
                      {label}
                    </div>
                  </a>
                ))}
              </div>
              <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
                Open each in a new tab to save, or right-click → Save image. Attach all three with your prompt in Claude, ChatGPT, Gemini, or Meta AI.
              </p>
            </div>

            <div>
              <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
                Prompt (includes numbered URLs for all samples). Open in AI; copy attaches to clipboard.{" "}
                {CHATGPT_META_GEMINI_LONG_URL_NOTICES}
              </p>
              <PromptTemplateBox
                tabId="org-chart"
                defaultTemplate={ORG_CHART_PROMPT_TEMPLATE}
                resolve={(tpl) =>
                  safeTicker
                    ? resolveOrgChartTemplate(tpl, { ticker: safeTicker, companyName, appOrigin })
                    : ""
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
        </div>
    </Card>
  );
}
