"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { EMPLOYEE_CONTACTS_PROMPT_TEMPLATE } from "@/data/employee-contacts-prompt";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { chatGptOpenStatusMessage, openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";
import { stripLlmCitationArtifacts } from "@/lib/strip-llm-citation-artifacts";
import { parseEmployeeContactsTable } from "@/lib/parse-employee-contacts-table";
import { buildOutreachLetter, openLinkedInOutreachDraftWindow } from "@/lib/linkedin-outreach";
import { usePersistedLinkedInOutreach } from "@/hooks/usePersistedLinkedInOutreach";
import { LinkedInOutreachSection } from "@/components/LinkedInOutreachSection";

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";

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

export function CompanyEmployeeContactsTab({
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
  const { outreachSig, setOutreachSig } = usePersistedLinkedInOutreach();

  const safeTicker = ticker?.trim() ?? "";
  const displayName = (companyName?.trim() || safeTicker) || "";

  const companyNameLine = (companyName?.trim() ?? "").length > 0 ? (companyName ?? "").trim() : "(unknown)";
  const { template: employeeContactsTemplate } = usePromptTemplateOverride(
    "employee-contacts",
    EMPLOYEE_CONTACTS_PROMPT_TEMPLATE
  );
  const prompt = safeTicker
    ? employeeContactsTemplate.replace(/\[INSERT TICKER\]/g, safeTicker).replace(
        /\[INSERT COMPANY NAME IF KNOWN\]/g,
        companyNameLine
      )
    : "";

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, displayName]);

  /** Rows parsed from saved HTML only (used in read-only view next to LinkedIn links). */
  const savedTableContacts = useMemo(() => {
    return parseEmployeeContactsTable(stripLlmCitationArtifacts(savedContent));
  }, [savedContent]);

  function handleMessageInLinkedIn(contact: { name: string; position: string; linkedinUrl: string | null }) {
    const marketDefault = `${displayName} and related industry / market dynamics`;
    const letter = buildOutreachLetter({
      letterTemplate: outreachSig.letterTemplate,
      contactName: contact.name,
      company: displayName,
      position: contact.position,
      marketLine: outreachSig.marketLine.trim() || marketDefault,
      yourName: outreachSig.yourName,
      yourTitle: outreachSig.yourTitle,
      yourEmail: outreachSig.yourEmail,
      yourPhone: outreachSig.yourPhone,
    });
    setStatusMessage(null);
    const ok = openLinkedInOutreachDraftWindow(contact.linkedinUrl, letter, contact.name);
    if (!ok) {
      setStatusMessage("Popup blocked �?allow popups for this site to open the message draft window.");
    }
  }

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      const loaded = await fetchSavedTabContent(safeTicker, "employee-contacts");
      if (!cancelled) {
        setSavedContent(stripLlmCitationArtifacts(loaded));
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  async function handleSaveResponse() {
    const trimmed = stripLlmCitationArtifacts(editDraft.trim());
    if (!safeTicker) return;
    await saveToServer(safeTicker, "employee-contacts", trimmed);
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
          setStatusMessage("Claude opened in a new tab. Prompt copied to clipboard �?paste into Claude if it didn't prefill."),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened in a new tab. Prompt could not be copied �?use the prompt below and paste into Claude.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened in a new tab. Prompt could not be copied �?use the prompt below and paste into Claude.");
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
      <Card title="Employee Contacts">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Employee Contacts — ${safeTicker}`}>
      <div className="flex flex-col gap-6 lg:flex-row">
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
                placeholder="Paste the HTML table response here, then click Save."
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
                  savedTableContacts.length > 0 ? (
                    <div className="saved-rich-text-table-scroll saved-html-content">
                      <table>
                        <thead>
                          <tr>
                            <th>Name</th>
                            <th>Position</th>
                            <th>LinkedIn</th>
                          </tr>
                        </thead>
                        <tbody>
                          {savedTableContacts.map((c, idx) => (
                            <tr key={`${idx}-${c.name}-${c.linkedinUrl ?? ""}`}>
                              <td>{c.name}</td>
                              <td>{c.position}</td>
                              <td>
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                                  {c.linkedinUrl ? (
                                    <a
                                      href={c.linkedinUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="underline break-all"
                                    >
                                      LinkedIn
                                    </a>
                                  ) : (
                                    <span style={{ color: "var(--muted2)" }}>—</span>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => handleMessageInLinkedIn(c)}
                                    className="shrink-0 rounded border px-2 py-1 text-[11px] font-semibold sm:text-xs"
                                    style={{
                                      borderColor: "#0a66c2",
                                      color: "#60a5fa",
                                      background: "rgba(10, 102, 194, 0.08)",
                                    }}
                                  >
                                    Message in Linkedin
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <SavedRichText content={savedContent} ticker={safeTicker} />
                  )
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
            tabId="employee-contacts"
            defaultTemplate={EMPLOYEE_CONTACTS_PROMPT_TEMPLATE}
            resolve={(tpl) =>
              safeTicker
                ? tpl.replace(/\[INSERT TICKER\]/g, safeTicker).replace(/\[INSERT COMPANY NAME IF KNOWN\]/g, companyNameLine)
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
              const trimmed = stripLlmCitationArtifacts(text.trim());
              if (!safeTicker) return;
              const ok = await saveToServer(safeTicker, "employee-contacts", trimmed);
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

      <LinkedInOutreachSection
        headingId="employee-contacts-outreach-heading"
        displayName={displayName}
        outreachSig={outreachSig}
        setOutreachSig={setOutreachSig}
        tabContext="employee"
      />
    </Card>
  );
}

