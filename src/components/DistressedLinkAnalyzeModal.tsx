"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import {
  CREDIT_DOC_ANALYZE_SAVE_TARGETS,
  creditDocAnalyzeSaveTargetForKey,
  type CreditDocSavedBoxKey,
} from "@/lib/credit-doc-save-targets";
import {
  appendRelevantBackgroundToDocReviewPrompt,
  EMPTY_CREDIT_DOC_REVIEW_BACKGROUND,
  type CreditDocReviewBackground,
} from "@/lib/credit-doc-review-background-client";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { saveToServer } from "@/lib/saved-data-client";

export function buildDistressedPromptForUrl(basePrompt: string, url: string): string {
  const u = url.trim();
  const b = basePrompt.trim();
  if (!u) return b;
  return `${b}\n\n---\nSOURCE DOCUMENT LINK (open this URL and read the full credit agreement / indenture / amendment before answering — do not rely on summaries):\n${u}\n`;
}

type Props = {
  open: boolean;
  url: string | null;
  docReviewPrompt: string;
  ticker: string;
  onClose: () => void;
  setStatusMessage: (s: string | null) => void;
  setClipboardFailed: (b: boolean) => void;
  onApiSaved: (targetLabel: string) => void;
};

export function DistressedLinkAnalyzeModal({
  open,
  url,
  docReviewPrompt,
  ticker,
  onClose,
  setStatusMessage,
  setClipboardFailed,
  onApiSaved,
}: Props) {
  const safeTicker = ticker.trim();
  const [saveTargetKey, setSaveTargetKey] = useState<CreditDocSavedBoxKey>(
    CREDIT_DOC_ANALYZE_SAVE_TARGETS[0]!.saveKey
  );
  const [background, setBackground] = useState<CreditDocReviewBackground>(
    EMPTY_CREDIT_DOC_REVIEW_BACKGROUND
  );
  const [backgroundLoading, setBackgroundLoading] = useState(false);

  useEffect(() => {
    if (!open || !safeTicker) {
      setBackground(EMPTY_CREDIT_DOC_REVIEW_BACKGROUND);
      return;
    }
    let cancelled = false;
    setBackgroundLoading(true);
    void (async () => {
      try {
        const res = await fetch(`/api/credit-doc-review-background/${encodeURIComponent(safeTicker)}`);
        if (!res.ok) return;
        const data = (await res.json()) as CreditDocReviewBackground;
        if (!cancelled) setBackground(data);
      } catch {
        if (!cancelled) setBackground(EMPTY_CREDIT_DOC_REVIEW_BACKGROUND);
      } finally {
        if (!cancelled) setBackgroundLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, safeTicker]);

  const promptWithBackground = useMemo(
    () => appendRelevantBackgroundToDocReviewPrompt(docReviewPrompt, background),
    [docReviewPrompt, background]
  );
  const fullPrompt = url ? buildDistressedPromptForUrl(promptWithBackground, url) : "";

  const runWeb = useCallback(
    async (
      fn: (p: string, sm: (s: string | null) => void, cf: (b: boolean) => void) => void | Promise<void>
    ) => {
      if (backgroundLoading || !fullPrompt.trim()) return;
      await fn(fullPrompt, setStatusMessage, setClipboardFailed);
      onClose();
    },
    [fullPrompt, backgroundLoading, setStatusMessage, setClipboardFailed, onClose]
  );

  if (!open || !url?.trim()) return null;

  return (
    <div
      className="fixed inset-0 z-[405] flex items-center justify-center px-3 py-8"
      style={{ background: "rgba(0,0,0,0.65)" }}
      role="presentation"
      onClick={() => onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="distressed-link-analyze-title"
        className="max-h-[min(90vh,720px)] w-full max-w-lg overflow-y-auto rounded-xl border p-4 shadow-xl sm:p-5"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="distressed-link-analyze-title"
          className="text-sm font-semibold tracking-tight"
          style={{ color: "var(--text)" }}
        >
          Distressed doc review
        </h3>
        <p className="mt-1 text-[10px] leading-snug break-all font-mono" style={{ color: "var(--muted2)" }}>
          {url}
        </p>
        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          Choose web chat (prompt copied to clipboard — open the source link in the chat) or run via API (review prompt before send).
        </p>
        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {OPEN_IN_EXTERNAL_AI_FULL_LINE}
        </p>
        {backgroundLoading ? (
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            Loading Capital Structure / Org Chart notes for the prompt…
          </p>
        ) : background.capitalStructureNotes || background.orgChartNotes ? (
          <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            Included Notes-tab background from your latest Capital Structure and/or Org Chart Excel files.
          </p>
        ) : null}

        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Open in browser
        </div>
        <div className="tab-prompt-ai-actions-grid mt-2">
          <button
            type="button"
            disabled={backgroundLoading}
            onClick={() => void runWeb(openClaudeWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            Open in Claude
          </button>
          <button
            type="button"
            disabled={backgroundLoading}
            onClick={() => void runWeb(openChatGptWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
          >
            Open in ChatGPT
          </button>
          <button
            type="button"
            disabled={backgroundLoading}
            onClick={() => void runWeb(openGeminiWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
          >
            Open in Gemini
          </button>
          <button
            type="button"
            disabled={backgroundLoading}
            onClick={() => void runWeb(openDeepSeekWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
          >
            Open in DeepSeek
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border2)] pt-4">
          <label
            htmlFor="distressed-analyze-save-target"
            className="mb-1 block text-[10px] font-semibold uppercase tracking-wide"
            style={{ color: "var(--muted)" }}
          >
            Save API response to
          </label>
          <select
            id="distressed-analyze-save-target"
            value={saveTargetKey}
            onChange={(e) => setSaveTargetKey(e.target.value as CreditDocSavedBoxKey)}
            className="mb-3 w-full rounded border px-2 py-1.5 text-sm"
            style={{
              borderColor: "var(--border2)",
              color: "var(--text)",
              background: "var(--card2)",
            }}
          >
            {CREDIT_DOC_ANALYZE_SAVE_TARGETS.map((target) => (
              <option key={target.saveKey} value={target.saveKey}>
                {target.label}
              </option>
            ))}
          </select>
          <TabPromptApiButtons
            userPrompt={backgroundLoading ? "" : fullPrompt}
            requirePromptReviewBeforeRun
            onResult={() => {
              /* result handled via persist */
            }}
            persistAfterResult={async (text) => {
              const t = text.trim();
              if (!safeTicker || !t) return;
              const target = creditDocAnalyzeSaveTargetForKey(saveTargetKey);
              const ok = await saveToServer(safeTicker, target.saveKey, t);
              if (!ok) throw new Error("Could not save response.");
              onApiSaved(target.label);
              onClose();
            }}
          />
        </div>

        <button
          type="button"
          onClick={() => onClose()}
          className="mt-4 w-full rounded border px-3 py-2 text-xs font-medium"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
