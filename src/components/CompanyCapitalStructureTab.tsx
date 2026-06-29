"use client";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import {
  CapitalStructureExcelProvider,
  CapitalStructureExcelUpload,
  CapitalStructureExcelViewer,
  CapitalStructureTabPromptApiButtons,
  useCapitalStructureExcel,
} from "@/components/CapitalStructureExcelFileBox";
import { CapitalStructureSecuritiesPanel } from "@/components/CapitalStructureSecuritiesPanel";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";
import {
  CAPITAL_STRUCTURE_PROMPT_TEMPLATE,
  resolveCapitalStructurePrompt,
} from "@/data/capital-structure-prompt";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openGeminiWithClipboard, OPEN_IN_EXTERNAL_AI_FULL_LINE } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";

function CapitalStructureTabBody({
  ticker,
  prompt,
  resolvePromptPreview,
  statusMessage,
  setStatusMessage,
  clipboardFailed,
  setClipboardFailed,
  onCopy,
  onClaude,
  onChatGpt,
  onGemini,
  onDeepSeek,
}: {
  ticker: string;
  prompt: string;
  resolvePromptPreview: (tpl: string) => string;
  statusMessage: string | null;
  setStatusMessage: (msg: string | null) => void;
  clipboardFailed: boolean;
  setClipboardFailed: (v: boolean) => void;
  onCopy: () => void;
  onClaude: () => void;
  onChatGpt: () => void;
  onGemini: () => void;
  onDeepSeek: () => void;
}) {
  const { latestItem } = useCapitalStructureExcel();

  return (
    <div className="space-y-8">
      <Card
        className="card-shell--excel-workbook"
        title={`Capital Structure - ${ticker}`}
        titleAside={
          <div className="card-header-excel-upload shrink-0">
            <CapitalStructureExcelUpload />
          </div>
        }
      >
        <CapitalStructureTabLayout
          prompt={prompt}
          resolvePromptPreview={resolvePromptPreview}
          statusMessage={statusMessage}
          setStatusMessage={setStatusMessage}
          clipboardFailed={clipboardFailed}
          setClipboardFailed={setClipboardFailed}
          onCopy={onCopy}
          onClaude={onClaude}
          onChatGpt={onChatGpt}
          onGemini={onGemini}
          onDeepSeek={onDeepSeek}
        />
      </Card>
      <CapitalStructureSecuritiesPanel
        ticker={ticker}
        latestExcelFilename={latestItem?.filename ?? null}
        refreshKey={latestItem?.id ?? null}
      />
    </div>
  );
}

function CapitalStructureTabLayout({
  prompt,
  resolvePromptPreview,
  statusMessage,
  setStatusMessage,
  clipboardFailed,
  setClipboardFailed,
  onCopy,
  onClaude,
  onChatGpt,
  onGemini,
  onDeepSeek,
}: {
  prompt: string;
  resolvePromptPreview: (tpl: string) => string;
  statusMessage: string | null;
  setStatusMessage: (msg: string | null) => void;
  clipboardFailed: boolean;
  setClipboardFailed: (v: boolean) => void;
  onCopy: () => void;
  onClaude: () => void;
  onChatGpt: () => void;
  onGemini: () => void;
  onDeepSeek: () => void;
}) {
  const { styledPreview, sheetNames } = useCapitalStructureExcel();
  const hasWorkbook = styledPreview != null && sheetNames.length > 0;

  return (
    <TabPromptSlideOutShell
      hasMainContent={hasWorkbook}
      main={<CapitalStructureExcelViewer />}
      prompt={
        <>
          <p className="text-xs mb-2 leading-relaxed" style={{ color: "var(--muted2)" }}>
            {OPEN_IN_EXTERNAL_AI_FULL_LINE}
          </p>
          <PromptTemplateBox
            tabId="capital-structure"
            defaultTemplate={CAPITAL_STRUCTURE_PROMPT_TEMPLATE}
            resolve={resolvePromptPreview}
            className="mb-3"
          />
          <div className="tab-prompt-ai-actions-grid mb-2">
            <button type="button" onClick={onClaude} className="tab-prompt-ai-action-btn" style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}>
              Open in Claude
            </button>
            <button type="button" onClick={onChatGpt} className="tab-prompt-ai-action-btn" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}>
              Open in ChatGPT
            </button>
            <button type="button" onClick={onGemini} className="tab-prompt-ai-action-btn" style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}>
              Open in Gemini
            </button>
            <button type="button" onClick={onDeepSeek} className="tab-prompt-ai-action-btn" style={{ borderColor: "#2563eb", color: "#2563eb", background: "transparent" }}>
              Open in DeepSeek
            </button>
            <button type="button" onClick={onCopy} className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton" style={{ borderColor: "var(--border2)", color: "var(--text)" }}>
              Copy prompt
            </button>
          </div>
          <CapitalStructureTabPromptApiButtons
            userPrompt={prompt}
            onApiFinished={() => setClipboardFailed(false)}
            onApiStatus={setStatusMessage}
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

  const safeTicker = ticker?.trim() ?? "";
  const [appOrigin, setAppOrigin] = useState("");

  useEffect(() => {
    setAppOrigin(typeof window !== "undefined" ? window.location.origin : "");
  }, []);

  const { template: capitalStructureTemplate } = usePromptTemplateOverride(
    "capital-structure",
    CAPITAL_STRUCTURE_PROMPT_TEMPLATE
  );
  const prompt = useMemo(() => {
    if (!safeTicker) return "";
    return resolveCapitalStructurePrompt({
      template: capitalStructureTemplate,
      ticker: safeTicker,
      appOrigin,
    });
  }, [capitalStructureTemplate, safeTicker, appOrigin]);

  const resolvePromptPreview = useCallback(
    (tpl: string) =>
      safeTicker ? resolveCapitalStructurePrompt({ template: tpl, ticker: safeTicker, appOrigin }) : "",
    [safeTicker, appOrigin]
  );

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

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
    void openClaudeWithClipboard(prompt, setStatusMessage, setClipboardFailed, (copyFailed) => {
      if (copyFailed) {
        return "Claude opened. Attach the reference sample images (URLs in the prompt) and paste manually.";
      }
      return "Claude opened. Prompt copied — paste into the chat; reference sample images are linked in the prompt and attached when you use Run API.";
    });
  }

  function openInChatGPT() {
    if (!prompt) return;
    void openChatGptWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "ChatGPT opened. Attach the reference sample images (URLs in the prompt) and paste manually.";
      }
      return "ChatGPT opened. Prompt copied — paste into the chat; reference sample images are linked in the prompt and attached when you use Run API.";
    });
  }

  function openInDeepSeek() {
    if (!prompt) return;
    void openDeepSeekWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "DeepSeek opened. Attach the reference sample images (URLs in the prompt) and paste manually.";
      }
      return "DeepSeek opened. Prompt copied — paste into the chat; reference sample images are linked in the prompt.";
    });
  }

  function openInGemini() {
    if (!prompt) return;
    void openGeminiWithClipboard(prompt, setStatusMessage, setClipboardFailed, (_ws, copyFailed) => {
      if (copyFailed) {
        return "Gemini opened. Attach the reference sample images (URLs in the prompt) and paste manually.";
      }
      return "Gemini opened. Prompt copied — paste into the chat; reference sample images are linked in the prompt and attached when you use Run API.";
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
    <CapitalStructureExcelProvider ticker={safeTicker}>
      <CapitalStructureTabBody
        ticker={safeTicker}
        prompt={prompt}
        resolvePromptPreview={resolvePromptPreview}
        statusMessage={statusMessage}
        setStatusMessage={setStatusMessage}
        clipboardFailed={clipboardFailed}
        setClipboardFailed={setClipboardFailed}
        onCopy={() => void copyToClipboard()}
        onClaude={openInClaude}
        onChatGpt={openInChatGPT}
        onGemini={openInGemini}
        onDeepSeek={openInDeepSeek}
      />
    </CapitalStructureExcelProvider>
  );
}
