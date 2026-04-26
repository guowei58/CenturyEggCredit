"use client";

import { useCallback } from "react";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import { saveToServer } from "@/lib/saved-data-client";

export function buildDistressedPromptForUrl(basePrompt: string, url: string): string {
  const u = url.trim();
  const b = basePrompt.trim();
  if (!u) return b;
  return `${b}\n\n---\nSOURCE LINK (open this filing and paste the full document text into the chat after the prompt):\n${u}\n`;
}

type Props = {
  open: boolean;
  url: string | null;
  docReviewPrompt: string;
  ticker: string;
  onClose: () => void;
  setStatusMessage: (s: string | null) => void;
  setClipboardFailed: (b: boolean) => void;
  onApiSaved: () => void;
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
  const fullPrompt = url ? buildDistressedPromptForUrl(docReviewPrompt, url) : "";
  const safeTicker = ticker.trim();

  const runWeb = useCallback(
    async (
      fn: (p: string, sm: (s: string | null) => void, cf: (b: boolean) => void) => void | Promise<void>
    ) => {
      if (!fullPrompt.trim()) return;
      await fn(fullPrompt, setStatusMessage, setClipboardFailed);
      onClose();
    },
    [fullPrompt, setStatusMessage, setClipboardFailed, onClose]
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
          Choose web chat (prompt is copied to your clipboard) or run via API (same behavior as Prompt 2 on the right).
        </p>
        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          {OPEN_IN_EXTERNAL_AI_FULL_LINE}
        </p>

        <div className="mt-3 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Open in browser
        </div>
        <div className="tab-prompt-ai-actions-grid mt-2">
          <button
            type="button"
            onClick={() => void runWeb(openClaudeWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            Open in Claude
          </button>
          <button
            type="button"
            onClick={() => void runWeb(openChatGptWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
          >
            Open in ChatGPT
          </button>
          <button
            type="button"
            onClick={() => void runWeb(openGeminiWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
          >
            Open in Gemini
          </button>
          <button
            type="button"
            onClick={() => void runWeb(openDeepSeekWithClipboard)}
            className="tab-prompt-ai-action-btn"
            style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}
          >
            Open in DeepSeek
          </button>
        </div>

        <TabPromptApiButtons
          userPrompt={fullPrompt}
          onResult={() => {
            /* result handled via persist */
          }}
          persistAfterResult={async (text) => {
            const t = text.trim();
            if (!safeTicker || !t) return;
            const ok = await saveToServer(safeTicker, "credit-agreements-indentures-credit-agreement", t);
            if (!ok) throw new Error("Could not save response.");
            onApiSaved();
            onClose();
          }}
          className="mt-4 border-t border-[var(--border2)] pt-4"
        />

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
