"use client";

import { copyExternalAiPrompt } from "@/lib/external-ai-clipboard";
import { openChatGptWithClipboard, type ExternalWebChatStatusFn } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard, type ClaudeWebChatStatusFn } from "@/lib/claude-web-chat-url";
import { openGeminiWithClipboard, type GeminiOpenStatusFn } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard, type DeepSeekOpenStatusFn } from "@/lib/deepseek-open-url";

type Props = {
  /** Legacy fallback when preview is unavailable. */
  prompt?: string;
  /** Called at click time so clipboard text matches the current prompt preview. */
  getPrompt: () => string;
  isEditingPrompt?: boolean;
  setStatusMessage: (s: string | null) => void;
  setClipboardFailed: (b: boolean) => void;
  buildClaudeStatus?: ClaudeWebChatStatusFn;
  buildChatGptStatus?: ExternalWebChatStatusFn;
  buildGeminiStatus?: GeminiOpenStatusFn;
  buildDeepSeekStatus?: DeepSeekOpenStatusFn;
  className?: string;
};

const EMPTY_PROMPT_MESSAGE =
  "No prompt to copy. Select a company or complete required fields, then try again.";

export function TabPromptOpenInAiButtons({
  prompt = "",
  getPrompt,
  isEditingPrompt: _isEditingPrompt = false,
  setStatusMessage,
  setClipboardFailed,
  buildClaudeStatus,
  buildChatGptStatus,
  buildGeminiStatus,
  buildDeepSeekStatus,
  className = "mb-2",
}: Props) {
  function resolvePrompt(): string {
    return getPrompt()?.trim() || prompt.trim();
  }

  async function copyToClipboard() {
    const text = resolvePrompt();
    if (!text) {
      setClipboardFailed(true);
      setStatusMessage(EMPTY_PROMPT_MESSAGE);
      return;
    }
    setClipboardFailed(false);
    setStatusMessage(null);
    const copied = await copyExternalAiPrompt(text);
    if (!copied) {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
      return;
    }
    setStatusMessage("Copied to clipboard.");
  }

  function openInClaude() {
    const text = resolvePrompt();
    if (!text) {
      setClipboardFailed(true);
      setStatusMessage(EMPTY_PROMPT_MESSAGE);
      return;
    }
    void openClaudeWithClipboard(text, setStatusMessage, setClipboardFailed, buildClaudeStatus);
  }

  function openInChatGPT() {
    const text = resolvePrompt();
    if (!text) {
      setClipboardFailed(true);
      setStatusMessage(EMPTY_PROMPT_MESSAGE);
      return;
    }
    void openChatGptWithClipboard(text, setStatusMessage, setClipboardFailed, buildChatGptStatus);
  }

  function openInGemini() {
    const text = resolvePrompt();
    if (!text) {
      setClipboardFailed(true);
      setStatusMessage(EMPTY_PROMPT_MESSAGE);
      return;
    }
    openGeminiWithClipboard(text, setStatusMessage, setClipboardFailed, buildGeminiStatus);
  }

  function openInDeepSeek() {
    const text = resolvePrompt();
    if (!text) {
      setClipboardFailed(true);
      setStatusMessage(EMPTY_PROMPT_MESSAGE);
      return;
    }
    openDeepSeekWithClipboard(text, setStatusMessage, setClipboardFailed, buildDeepSeekStatus);
  }

  return (
    <div className={`tab-prompt-ai-actions-grid ${className}`.trim()}>
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
        onClick={() => void copyToClipboard()}
        className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
        style={{ borderColor: "var(--border2)", color: "var(--text)" }}
      >
        Copy prompt
      </button>
    </div>
  );
}
