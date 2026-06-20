"use client";
import { copyExternalAiPrompt } from "@/lib/external-ai-clipboard";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui";
import {
  COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE,
  EMPTY_COMPETITOR_EARNINGS_READTHRUS_INPUTS,
  fillCompetitorEarningsReadThrusPrompt,
  parseCompetitorEarningsReadThrusInputs,
  type CompetitorEarningsReadThrusInputs,
} from "@/data/competitor-earnings-readthrus-prompt";
import { fetchSavedFromServer, fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { openChatGptWithClipboard } from "@/lib/chatgpt-open-url";
import { openClaudeWithClipboard } from "@/lib/claude-web-chat-url";
import { OPEN_IN_EXTERNAL_AI_FULL_LINE, openGeminiWithClipboard } from "@/lib/gemini-open-url";
import { openDeepSeekWithClipboard } from "@/lib/deepseek-open-url";
import {
  SavedResponseExpandableShell,
  SAVED_RESPONSE_EDIT_CLASS,
  SAVED_RESPONSE_SHELL_CLASS,
  SAVED_RESPONSE_VIEW_CLASS,
} from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

const SAVE_KEY = "competitor-earnings-readthrus" as const;
const INPUTS_KEY = "competitor-earnings-readthrus-inputs" as const;
const TAB_OVERRIDE_ID = "competitor-earnings-readthrus" as const;

const inputClass =
  "mt-1 w-full rounded border bg-[var(--card2)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent)] focus:outline-none";

function hasMeaningfulInputs(inputs: CompetitorEarningsReadThrusInputs): boolean {
  return Boolean(inputs.transcriptCompanyTickers.trim() || inputs.areasOfSpecialConcern.trim());
}

function shouldCollapseInputsSection(
  savedResponse: string,
  inputs: CompetitorEarningsReadThrusInputs
): boolean {
  return savedResponse.trim().length > 0 || hasMeaningfulInputs(inputs);
}

function inputsSummary(inputs: CompetitorEarningsReadThrusInputs): string {
  const tickers = inputs.transcriptCompanyTickers.trim();
  const areas = inputs.areasOfSpecialConcern.trim();
  if (tickers && areas) {
    const areasPreview = areas.length > 72 ? `${areas.slice(0, 72)}…` : areas;
    return `${tickers} · ${areasPreview}`;
  }
  if (tickers) return tickers;
  if (areas) return areas.length > 120 ? `${areas.slice(0, 120)}…` : areas;
  return "No transcript companies specified — model will identify relevant companies.";
}

export function CompanyCompetitorEarningsReadThrusTab({
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
  const [inputs, setInputs] = useState<CompetitorEarningsReadThrusInputs>(
    EMPTY_COMPETITOR_EARNINGS_READTHRUS_INPUTS
  );
  const [isInputsCollapsed, setIsInputsCollapsed] = useState(false);

  const inputsHydratedRef = useRef(false);
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const safeTicker = ticker?.trim() ?? "";
  const { template: promptTemplate } = usePromptTemplateOverride(
    TAB_OVERRIDE_ID,
    COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE
  );
  const prompt = useMemo(
    () =>
      safeTicker
        ? fillCompetitorEarningsReadThrusPrompt(promptTemplate, safeTicker, companyName, inputs)
        : "",
    [safeTicker, companyName, promptTemplate, inputs]
  );

  const persistInputs = useCallback(
    async (next: CompetitorEarningsReadThrusInputs) => {
      if (!safeTicker) return;
      await saveToServer(safeTicker, INPUTS_KEY, JSON.stringify(next, null, 2));
    },
    [safeTicker]
  );

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker, companyName]);

  useEffect(() => {
    if (!safeTicker) return;
    inputsHydratedRef.current = false;
    let cancelled = false;
    (async () => {
      const [loadedResponse, loadedInputsRaw] = await Promise.all([
        fetchSavedTabContent(safeTicker, SAVE_KEY),
        fetchSavedFromServer(safeTicker, INPUTS_KEY),
      ]);
      if (cancelled) return;
      setSavedContent(loadedResponse);
      setIsEditing(loadedResponse.length === 0);
      setEditDraft("");
      const parsedInputs = parseCompetitorEarningsReadThrusInputs(loadedInputsRaw);
      setInputs(parsedInputs);
      setIsInputsCollapsed(shouldCollapseInputsSection(loadedResponse, parsedInputs));
      inputsHydratedRef.current = true;
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  function patchInputs(patch: Partial<CompetitorEarningsReadThrusInputs>) {
    setInputs((prev) => ({ ...prev, ...patch }));
  }

  function handleInputsBlur() {
    if (!inputsHydratedRef.current) return;
    const next = inputsRef.current;
    void persistInputs(next);
    if (hasMeaningfulInputs(next)) {
      setIsInputsCollapsed(true);
    }
  }

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, SAVE_KEY, trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
    setIsInputsCollapsed(true);
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  async function copyToClipboard() {
    if (!prompt) return;
    setClipboardFailed(false);
    setStatusMessage(null);
    const copied = await copyExternalAiPrompt(prompt);
    if (!copied) {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
      return;
    }
    setStatusMessage("Copied to clipboard.");
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
      <Card title="Competitor Earnings ReadThrus">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, Gemini, or DeepSeek.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Competitor Earnings ReadThrus - ${safeTicker}`}>
      {isInputsCollapsed ? (
        <div
          className="mb-4 flex items-start justify-between gap-3 rounded border px-3 py-2"
          style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
        >
          <p className="min-w-0 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
            <span className="font-medium" style={{ color: "var(--text)" }}>
              Transcript settings:{" "}
            </span>
            {inputsSummary(inputs)}
          </p>
          <button
            type="button"
            onClick={() => setIsInputsCollapsed(false)}
            className="shrink-0 rounded border px-2 py-1 text-[11px] font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
          >
            Edit
          </button>
        </div>
      ) : (
        <div
          className="mb-4 space-y-3 rounded border p-3"
          style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              Tell the model which earnings-call transcripts to prioritize. Leave blank to have it identify
              relevant public companies on its own.
            </p>
            {(hasMeaningfulInputs(inputs) || savedContent.trim().length > 0) && (
              <button
                type="button"
                onClick={() => setIsInputsCollapsed(true)}
                className="shrink-0 rounded border px-2 py-1 text-[11px] font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
              >
                Minimize
              </button>
            )}
          </div>
          <label className="block text-xs font-medium" style={{ color: "var(--text)" }}>
            Transcript company tickers (optional)
            <input
              type="text"
              value={inputs.transcriptCompanyTickers}
              onChange={(e) => patchInputs({ transcriptCompanyTickers: e.target.value })}
              onBlur={handleInputsBlur}
              placeholder="CRM, NOW, WDAY — competitors, suppliers, customers, distributors"
              className={inputClass}
              style={{ borderColor: "var(--border2)" }}
            />
          </label>
          <label className="block text-xs font-medium" style={{ color: "var(--text)" }}>
            Areas of special concern (optional)
            <textarea
              value={inputs.areasOfSpecialConcern}
              onChange={(e) => patchInputs({ areasOfSpecialConcern: e.target.value })}
              onBlur={handleInputsBlur}
              placeholder="Pricing pressure, channel inventory, customer budget cuts, AI disruption…"
              rows={3}
              className={`${inputClass} resize-y min-h-[4.5rem]`}
              style={{ borderColor: "var(--border2)" }}
            />
          </label>
        </div>
      )}

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
                <div className={SAVED_RESPONSE_VIEW_CLASS} style={{ color: "var(--text)" }}>
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
        }
        prompt={
          <>
            <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
              {OPEN_IN_EXTERNAL_AI_FULL_LINE}
            </p>
            <PromptTemplateBox
              tabId={TAB_OVERRIDE_ID}
              defaultTemplate={COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE}
              resolve={(tpl) =>
                safeTicker
                  ? fillCompetitorEarningsReadThrusPrompt(tpl, safeTicker, companyName, inputs)
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
              researchSaveKey={SAVE_KEY}
              userPrompt={prompt}
              onRunStart={() => {
                void persistInputs(inputsRef.current);
                setIsInputsCollapsed(true);
              }}
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
                setIsInputsCollapsed(true);
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
