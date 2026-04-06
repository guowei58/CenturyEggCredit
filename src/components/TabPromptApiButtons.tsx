"use client";

import { useCallback, useState } from "react";
import type { AiProvider } from "@/lib/ai-provider";
import { AI_PROVIDER_CHIP_SELECTED } from "@/lib/ai-provider";
import { modelOverridePayloadForProvider } from "@/lib/ai-model-prefs-client";
import {
  META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE,
  showMetaOllamaPlaceholder,
} from "@/lib/meta-ollama-ui-placeholder";

const API_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "ollama"];

const LABELS: Record<AiProvider, string> = {
  claude: "Claude API",
  openai: "ChatGPT API",
  gemini: "Gemini API",
  ollama: "Ollama API",
};

type Props = {
  userPrompt: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  /** Called with model markdown/plain text when the API succeeds */
  onResult: (text: string) => void;
  className?: string;
};

export function TabPromptApiButtons({
  userPrompt,
  systemPrompt,
  maxOutputTokens = 8192,
  onResult,
  className = "",
}: Props) {
  const [pending, setPending] = useState<AiProvider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    async (provider: AiProvider) => {
      const trimmed = userPrompt.trim();
      if (!trimmed || pending) return;
      if (provider === "ollama" && META_AND_OLLAMA_UI_PLACEHOLDER_ACTIVE) {
        showMetaOllamaPlaceholder();
        return;
      }
      setError(null);
      setPending(provider);
      try {
        const res = await fetch("/api/tab-prompt-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            userPrompt: trimmed,
            maxTokens: maxOutputTokens,
            ...(systemPrompt?.trim() ? { systemPrompt: systemPrompt.trim() } : {}),
            ...modelOverridePayloadForProvider(provider),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
        if (!res.ok || data.ok !== true || typeof data.text !== "string") {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        onResult(data.text);
      } catch (e) {
        setError(e instanceof Error ? e.message : "API request failed");
      } finally {
        setPending(null);
      }
    },
    [userPrompt, systemPrompt, maxOutputTokens, onResult, pending]
  );

  const noPrompt = !userPrompt.trim();

  return (
    <div className={className}>
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Or run via API (server keys / Ollama)
      </div>
      <div className="tab-prompt-ai-actions-grid">
        {API_PROVIDERS.map((p) => {
          const sel = AI_PROVIDER_CHIP_SELECTED[p];
          const isPending = pending === p;
          const inactiveWhileOtherRuns = pending !== null && pending !== p;
          return (
            <button
              key={p}
              type="button"
              disabled={noPrompt || inactiveWhileOtherRuns}
              onClick={() => void run(p)}
              className="tab-prompt-ai-action-btn"
              style={{
                borderColor: sel.background,
                color: isPending ? "#fff" : sel.background,
                background: isPending ? sel.background : "transparent",
              }}
            >
              {isPending ? `${LABELS[p]}…` : LABELS[p]}
            </button>
          );
        })}
      </div>
      {error ? (
        <p className="mt-2 text-xs leading-snug" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
