"use client";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import {
  OPEN_IN_EXTERNAL_AI_FULL_LINE,
  openGeminiWithClipboard,
} from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_EDIT_CLASS, SAVED_RESPONSE_SHELL_CLASS, SAVED_RESPONSE_VIEW_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { DistressedLinkAnalyzeModal } from "@/components/DistressedLinkAnalyzeModal";
import type { CreditDocSavedBoxKey } from "@/lib/credit-doc-save-targets";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

import {
  PROMPT_TEMPLATE,
  DOC_REVIEW_PROMPT,
  buildCreditAgreementsFindDocsAiPrompt,
  getCreditAgreementsDocReviewAiPrompt,
} from "@/lib/credit-agreements-prompts";

export {
  PROMPT_TEMPLATE,
  DOC_REVIEW_PROMPT,
  buildCreditAgreementsFindDocsAiPrompt,
  getCreditAgreementsDocReviewAiPrompt,
};

const SAVED_PREFIX = "century-egg-credit-agreements-indentures-";

export type { CreditDocSavedBoxKey } from "@/lib/credit-doc-save-targets";

export type CreditDocWorkspaceVariant =
  | "credit-docs-list"
  | "credit-agreement"
  | "first-lien-notes"
  | "second-lien-notes"
  | "unsecured-notes"
  | "other-credit-documents";

type CreditDocVariantConfig = {
  cardTitle: string;
  boxTitle: string;
  saveKey: CreditDocSavedBoxKey;
  storagePrefix: string;
  fallback?: { key: "credit-agreements-indentures"; storagePrefix: string };
  enableLinkAnalyze: boolean;
  showFindDocsPrompt: boolean;
  /** When set, slide-out shows list→Analyze instructions instead of a local prompt. */
  analyzeFromListDocumentLabel?: string;
};

export const CREDIT_DOC_WORKSPACE_VARIANTS: Record<CreditDocWorkspaceVariant, CreditDocVariantConfig> = {
  "credit-docs-list": {
    cardTitle: "Credit Docs List",
    boxTitle: "Document list",
    saveKey: "credit-agreements-indentures-other",
    storagePrefix: "century-egg-credit-agreements-indentures-other-",
    fallback: { key: "credit-agreements-indentures", storagePrefix: SAVED_PREFIX },
    enableLinkAnalyze: true,
    showFindDocsPrompt: true,
  },
  "credit-agreement": {
    cardTitle: "Credit Agreement",
    boxTitle: "Credit agreement",
    saveKey: "credit-agreements-indentures-credit-agreement",
    storagePrefix: "century-egg-credit-agreements-indentures-credit-agreement-",
    enableLinkAnalyze: false,
    showFindDocsPrompt: false,
    analyzeFromListDocumentLabel: "credit agreement",
  },
  "first-lien-notes": {
    cardTitle: "First Lien Notes",
    boxTitle: "First lien notes",
    saveKey: "credit-agreements-indentures-first-lien-indenture",
    storagePrefix: "century-egg-credit-agreements-indentures-first-lien-indenture-",
    enableLinkAnalyze: false,
    showFindDocsPrompt: false,
    analyzeFromListDocumentLabel: "first lien notes",
  },
  "second-lien-notes": {
    cardTitle: "2nd Lien Notes",
    boxTitle: "2nd lien notes",
    saveKey: "credit-agreements-indentures-second-lien-indenture",
    storagePrefix: "century-egg-credit-agreements-indentures-second-lien-indenture-",
    enableLinkAnalyze: false,
    showFindDocsPrompt: false,
    analyzeFromListDocumentLabel: "2nd lien notes",
  },
  "unsecured-notes": {
    cardTitle: "Unsecured Notes",
    boxTitle: "Unsecured notes",
    saveKey: "credit-agreements-indentures-unsecured",
    storagePrefix: "century-egg-credit-agreements-indentures-unsecured-",
    enableLinkAnalyze: false,
    showFindDocsPrompt: false,
    analyzeFromListDocumentLabel: "unsecured notes",
  },
  "other-credit-documents": {
    cardTitle: "Other Credit Documents",
    boxTitle: "Other credit documents",
    saveKey: "credit-agreements-indentures-other-credit-documents",
    storagePrefix: "century-egg-credit-agreements-indentures-other-credit-documents-",
    enableLinkAnalyze: false,
    showFindDocsPrompt: false,
    analyzeFromListDocumentLabel: "other credit documents",
  },
};

export const CREDIT_DOC_TAB_ID_TO_VARIANT: Record<string, CreditDocWorkspaceVariant> = {
  "credit-docs-list": "credit-docs-list",
  "credit-agreement": "credit-agreement",
  "first-lien-notes": "first-lien-notes",
  "2nd-lien-notes": "second-lien-notes",
  "unsecured-notes": "unsecured-notes",
  "other-credit-documents": "other-credit-documents",
  /** Legacy bookmark for the old combined tab. */
  "credit-agreements-indentures": "credit-docs-list",
};

function SavedResponseBox({
  ticker,
  title,
  saveKey,
  storagePrefix,
  fallback,
  refreshKey = 0,
  onLinkAnalyze,
}: {
  ticker: string;
  title: string;
  saveKey: CreditDocSavedBoxKey;
  storagePrefix: string;
  fallback?: { key: "credit-agreements-indentures"; storagePrefix: string };
  /** Increment when another control (e.g. API) writes this key so we reload from server. */
  refreshKey?: number;
  /** Document list only: opens distressed-doc modal per SEC link. */
  onLinkAnalyze?: (url: string) => void;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      let loaded = await fetchSavedTabContent(safeTicker, saveKey);
      if (!loaded.trim() && fallback) {
        loaded = await fetchSavedTabContent(safeTicker, fallback.key);
      }

      if (!cancelled) {
        setSavedContent(loaded);
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker, saveKey, storagePrefix, fallback, refreshKey]);

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, saveKey, trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  return (
    <SavedResponseExpandableShell
      title={title}
      className={SAVED_RESPONSE_SHELL_CLASS}
      ticker={safeTicker}
      linkSourceText={isEditing ? editDraft : savedContent}
    >
      {isEditing ? (
        <>
          <RichPasteTextarea
            value={editDraft}
            onChange={setEditDraft}
            placeholder="Paste your notes / extraction / AI output here, then click Save."
            className={SAVED_RESPONSE_EDIT_CLASS}
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
            className={SAVED_RESPONSE_VIEW_CLASS}
            style={{ color: "var(--text)" }}
          >
            {savedContent ? (
              <SavedRichText content={savedContent} ticker={safeTicker} onLinkAnalyze={onLinkAnalyze} />
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
  );
}


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

export function CompanyCreditDocWorkspaceTab({
  ticker,
  variant,
}: {
  ticker: string;
  variant: CreditDocWorkspaceVariant;
}) {
  const config = CREDIT_DOC_WORKSPACE_VARIANTS[variant];
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);
  const [analyzeModalUrl, setAnalyzeModalUrl] = useState<string | null>(null);
  const [hasAnySavedContent, setHasAnySavedContent] = useState(false);

  const openDistressedAnalyzeForUrl = useCallback((url: string) => {
    setAnalyzeModalUrl(url.trim());
  }, []);

  const safeTicker = ticker?.trim() ?? "";
  const { template: findDocsTemplate } = usePromptTemplateOverride(
    "credit-agreements-find-docs",
    PROMPT_TEMPLATE
  );
  const prompt = useMemo(
    () => (safeTicker ? fillCompanyPromptTemplate(findDocsTemplate, safeTicker) : ""),
    [safeTicker, findDocsTemplate]
  );
  const { template: docReviewTemplate } = usePromptTemplateOverride(
    "credit-agreements-doc-review",
    DOC_REVIEW_PROMPT
  );
  const docReviewPrompt = docReviewTemplate;

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, variant]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      let content = await fetchSavedTabContent(safeTicker, config.saveKey);
      if (!content.trim() && config.fallback) {
        content = await fetchSavedTabContent(safeTicker, config.fallback.key);
      }
      if (!cancelled) {
        setHasAnySavedContent(content.trim().length > 0);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker, config.saveKey, config.fallback, savedRefreshKey]);

  async function copyText(text: string) {
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(withPromptBenchmarkNotice(text));
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Copy manually from the prompt window.");
    }
  }

  function openInClaude(text: string) {
    if (!text) return;
    void openClaudeWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  function openInChatGPT(text: string) {
    if (!text) return;
    void openChatGptWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  function openInDeepSeek(text: string) {
    if (!text) return;
    openDeepSeekWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  function openInGemini(text: string) {
    if (!text) return;
    openGeminiWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title={config.cardTitle}>
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`${config.cardTitle} - ${safeTicker}`}>
      {config.enableLinkAnalyze ? (
      <DistressedLinkAnalyzeModal
        open={analyzeModalUrl !== null}
        url={analyzeModalUrl}
        docReviewPrompt={docReviewPrompt}
        ticker={safeTicker}
        onClose={() => setAnalyzeModalUrl(null)}
        setStatusMessage={setStatusMessage}
        setClipboardFailed={setClipboardFailed}
        onApiSaved={(targetLabel) => {
          setStatusMessage(`API response saved to the ${targetLabel} box. Open that tab to review.`);
        }}
      />
      ) : null}
      <TabPromptSlideOutShell
        hasMainContent={hasAnySavedContent}
        main={
          <div className="min-w-0 space-y-4">
            <SavedResponseBox
              ticker={safeTicker}
              title={config.boxTitle}
              saveKey={config.saveKey}
              storagePrefix={config.storagePrefix}
              fallback={config.fallback}
              refreshKey={savedRefreshKey}
              onLinkAnalyze={config.enableLinkAnalyze ? openDistressedAnalyzeForUrl : undefined}
            />
          </div>
        }
        prompt={
          <div className="flex w-full flex-col gap-4">
          {config.showFindDocsPrompt ? (
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
              Find documents
            </div>
            <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
              {OPEN_IN_EXTERNAL_AI_FULL_LINE}
            </p>
            <PromptTemplateBox
              tabId="credit-agreements-find-docs"
              defaultTemplate={PROMPT_TEMPLATE}
              resolve={(tpl) => (safeTicker ? fillCompanyPromptTemplate(tpl, safeTicker) : "")}
              className="mb-3"
            />
            <div className="tab-prompt-ai-actions-grid mb-2">
              <button
                type="button"
                onClick={() => openInClaude(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              >
                Open in Claude
              </button>
              <button
                type="button"
                onClick={() => openInChatGPT(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
              >
                Open in ChatGPT
              </button>
              <button
                type="button"
                onClick={() => openInGemini(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
              >
                Open in Gemini
              </button>
              <button
                type="button"
                onClick={() => openInDeepSeek(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
              >
                Open in DeepSeek
              </button>
              <button
                type="button"
                onClick={() => void copyText(prompt)}
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
                const t = text.trim();
                if (!safeTicker || !t) return;
                const ok = await saveToServer(safeTicker, config.saveKey, t);
                if (!ok) throw new Error("Could not save response.");
                setSavedRefreshKey((k) => k + 1);
                setStatusMessage(`API response saved to the ${config.boxTitle} box above.`);
              }}
              className="mt-2 border-t border-[var(--border2)] pt-2"
            />
          </div>
          ) : null}

          {config.analyzeFromListDocumentLabel ? (
          <div
            className="rounded-lg border px-3 py-3 text-sm leading-relaxed"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
          >
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              How to fill this box
            </div>
            <ol className="list-decimal space-y-2 pl-5 text-sm" style={{ color: "var(--text)" }}>
              <li>
                Go to the <strong>Credit Docs List</strong> page (Capital Structure section) and update the document list for this company&apos;s credit docs.
              </li>
              <li>
                For each relevant <strong>{config.analyzeFromListDocumentLabel}</strong> document link in that list, click <strong>Analyze</strong>.
              </li>
              <li>
                Run the distressed doc review in your AI tool (or via API), then copy and paste the results into the <strong>{config.boxTitle}</strong> response box above and click <strong>Save</strong>.
              </li>
            </ol>
          </div>
          ) : null}
          {statusMessage && (
            <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
              {statusMessage}
            </p>
          )}
          {clipboardFailed && (
            <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
              Select the prompt above and copy manually (Ctrl+C / Cmd+C).
            </p>
          )}

          </div>
        }
      />
    </Card>
  );
}

/** @deprecated Use CompanyCreditDocWorkspaceTab with variant `credit-docs-list`. */
export function CompanyCreditAgreementsIndenturesTab({ ticker }: { ticker: string }) {
  return <CompanyCreditDocWorkspaceTab ticker={ticker} variant="credit-docs-list" />;
}

