"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { RECENT_EVENTS_PROMPT_TEMPLATE } from "@/data/recent-events-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE } from "@/lib/gemini-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptOpenInAiButtons } from "@/components/TabPromptOpenInAiButtons";
import { useTabPromptExport } from "@/lib/use-tab-prompt-export";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

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

export function CompanyRecentEventsTab({
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
  const { template: recentEventsTemplate } = usePromptTemplateOverride("recent-events", RECENT_EVENTS_PROMPT_TEMPLATE);
  const prompt = safeTicker ? fillCompanyPromptTemplate(recentEventsTemplate, safeTicker, companyName) : "";

  const fillPrompt = useCallback(() => prompt, [prompt]);
  const { onResolvedPromptChange, getPromptForExport, isEditingPrompt } = useTabPromptExport(fillPrompt);

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, companyName]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "recent-events");
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
    await saveToServer(safeTicker, "recent-events", trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  if (!safeTicker) {
    return (
      <Card title="Recent Events">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Recent Events - ${safeTicker}`}>
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
            tabId="recent-events"
            defaultTemplate={RECENT_EVENTS_PROMPT_TEMPLATE}
            resolve={(tpl) => (safeTicker ? fillCompanyPromptTemplate(tpl, safeTicker, companyName) : "")}
              onResolvedPromptChange={onResolvedPromptChange}
            className="mb-3"
          />
          
<TabPromptOpenInAiButtons
  prompt={prompt}
  getPrompt={getPromptForExport}
  isEditingPrompt={isEditingPrompt}
  setStatusMessage={setStatusMessage}
              setClipboardFailed={setClipboardFailed}
            />
            <TabPromptApiButtons
            researchSaveKey="recent-events"
            userPrompt={prompt}
            onResult={() => {
              setClipboardFailed(false);
            }}
            persistAfterResult={async (text) => {
              const trimmed = text.trim();
              if (!safeTicker) return;
              const ok = await saveToServer(safeTicker, "recent-events", trimmed);
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
          {clipboardFailed && getPromptForExport().trim() && (
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
