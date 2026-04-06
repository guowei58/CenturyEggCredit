"use client";

import { useState } from "react";
import {
  runBulkOpenChatGPT,
  runBulkOpenClaude,
  runBulkOpenGemini,
  runBulkOpenMetaAi,
  runBulkUpdateViaApi,
} from "@/lib/bulk-ai-open";
import type { AiProvider } from "@/lib/ai-provider";
import { CHATGPT_LONG_URL_NOTICE } from "@/lib/chatgpt-open-url";
import { GEMINI_LONG_URL_NOTICE, GEMINI_UI_BUTTON_COLOR } from "@/lib/gemini-open-url";
import { META_AI_LONG_URL_NOTICE } from "@/lib/meta-ai-open-url";
import {
  META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE,
  showMetaOllamaPlaceholder,
} from "@/lib/meta-ollama-ui-placeholder";

const OLLAMA_BULK_COLOR = "#2563eb";

/** Bulk bar: fixed min-height so UI/API rows align; centered label; subtle fill reads calmer on dark sb. */
const bulkBarBtnClass =
  "tab-prompt-ai-action-btn inline-flex w-full min-h-[2.75rem] items-center justify-center whitespace-normal px-2 py-2 text-center text-[11px] font-semibold leading-snug sm:min-h-[2.5rem] sm:px-3 sm:text-xs sm:leading-tight disabled:cursor-not-allowed disabled:opacity-45 bg-[var(--card2)] transition-opacity hover:opacity-95";

export type CompanyBarData = {
  ticker: string;
  name: string;
};

export function CompanyBar({
  data,
  companyNameForPrompts,
}: {
  data: CompanyBarData;
  /** Resolved company name for prompt substitution (may match `data.name` or be null while loading). */
  companyNameForPrompts?: string | null;
}) {
  const [bulkApiBusy, setBulkApiBusy] = useState<AiProvider | null>(null);
  const [bulkApiLine, setBulkApiLine] = useState<string | null>(null);

  function bulkCtx() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      ticker: data.ticker,
      companyName: companyNameForPrompts ?? data.name,
      appOrigin: origin,
    };
  }

  async function startBulkApi(provider: AiProvider) {
    if (bulkApiBusy || !data.ticker.trim()) return;
    if (provider === "ollama" && META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE) {
      showMetaOllamaPlaceholder();
      return;
    }
    const who =
      provider === "claude"
        ? "Claude API"
        : provider === "openai"
          ? "ChatGPT API"
          : provider === "gemini"
            ? "Gemini API"
            : "Ollama API";
    const ok = window.confirm(
      `${who} will run all research prompts for ${data.ticker.toUpperCase()} and overwrite (save over) any existing saved answers in those tabs.\n\nContinue?`
    );
    if (!ok) return;
    setBulkApiBusy(provider);
    setBulkApiLine(null);
    try {
      const r = await runBulkUpdateViaApi(bulkCtx(), provider, (p) => {
        setBulkApiLine(`${who}: ${p.index}/${p.total} — ${p.label}`);
      });
      setBulkApiLine(null);
      const head = `Bulk API finished: ${r.ok} saved, ${r.fail} failed.`;
      if (r.errors.length) {
        window.alert(
          `${head}\n\n${r.errors.slice(0, 10).join("\n")}${r.errors.length > 10 ? "\n…" : ""}`
        );
      } else {
        window.alert(head);
      }
    } catch (e) {
      setBulkApiLine(null);
      window.alert(e instanceof Error ? e.message : "Bulk API failed");
    } finally {
      setBulkApiBusy(null);
    }
  }

  return (
    <div
      className="flex flex-shrink-0 flex-col border-b px-5 py-3.5 sm:px-6 sm:py-4"
      style={{ background: "var(--sb)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 shrink-0 items-center gap-3 sm:gap-3.5">
          <span
            className="inline-flex shrink-0 items-center justify-center rounded-md px-2.5 py-1.5 font-mono text-xs font-bold tracking-wide text-black sm:text-sm"
            style={{ background: "var(--accent)" }}
          >
            {data.ticker}
          </span>
          <div
            className="min-w-0 text-base font-semibold leading-tight tracking-tight sm:text-lg"
            style={{ color: "var(--text)" }}
          >
            {data.name}
          </div>
        </div>

        <div className="min-w-0 w-full lg:max-w-[min(100%,52rem)] lg:flex-1">
          <div className="flex flex-col gap-2">
            <div className="grid w-full grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4 md:items-stretch">
              <button
                type="button"
                className={bulkBarBtnClass}
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                title="Opens many Claude tabs—one per research prompt. Allow pop-ups if the browser blocks some."
                onClick={() => runBulkOpenClaude(bulkCtx())}
              >
                Update all via Claude
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                title={`Opens many ChatGPT tabs with the same prompts. ${CHATGPT_LONG_URL_NOTICE} Allow pop-ups if the browser blocks some.`}
                onClick={() => runBulkOpenChatGPT(bulkCtx())}
              >
                Update all via ChatGPT
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                style={{ borderColor: GEMINI_UI_BUTTON_COLOR, color: GEMINI_UI_BUTTON_COLOR }}
                title={`Opens many Gemini tabs with the same prompts. ${GEMINI_LONG_URL_NOTICE} Allow pop-ups if the browser blocks some.`}
                onClick={() => runBulkOpenGemini(bulkCtx())}
              >
                Update all via Gemini
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                style={{ borderColor: "#0866FF", color: "#0866FF" }}
                title={`Opens many Meta AI tabs with the same prompts. ${META_AI_LONG_URL_NOTICE} Allow pop-ups if the browser blocks some.`}
                onClick={() => runBulkOpenMetaAi(bulkCtx())}
              >
                Update all via Meta AI
              </button>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4 md:items-stretch">
              <button
                type="button"
                className={bulkBarBtnClass}
                disabled={bulkApiBusy !== null}
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                title="Runs every research prompt through the Claude API and saves each answer to the matching tab (uses server API key)."
                onClick={() => void startBulkApi("claude")}
              >
                Update all via Claude API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                disabled={bulkApiBusy !== null}
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                title="Runs every research prompt through the OpenAI API and saves each answer to the matching tab."
                onClick={() => void startBulkApi("openai")}
              >
                Update all via ChatGPT API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                disabled={bulkApiBusy !== null}
                style={{ borderColor: GEMINI_UI_BUTTON_COLOR, color: GEMINI_UI_BUTTON_COLOR }}
                title="Runs every research prompt through the Gemini API and saves each answer to the matching tab."
                onClick={() => void startBulkApi("gemini")}
              >
                Update all via Gemini API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                disabled={bulkApiBusy !== null}
                style={{ borderColor: OLLAMA_BULK_COLOR, color: OLLAMA_BULK_COLOR }}
                title="Runs every research prompt through local Ollama (Meta AI has no API bulk path here)."
                onClick={() => void startBulkApi("ollama")}
              >
                Update all via Ollama API
              </button>
            </div>
            {bulkApiLine ? (
              <p className="text-[10px] leading-snug sm:text-[11px] lg:text-right" style={{ color: "var(--muted2)" }}>
                {bulkApiLine}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
