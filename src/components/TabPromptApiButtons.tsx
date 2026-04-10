"use client";

import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { AiProvider } from "@/lib/ai-provider";
import { AI_PROVIDER_CHIP_SELECTED } from "@/lib/ai-provider";
import { modelPayloadForRun, type ModelRunChoice } from "@/lib/ai-model-prefs-client";
import { USER_LLM_API_KEYS_POLICY } from "@/lib/llm-user-key-messages";
import { userHasCloudApiKeyForProvider } from "@/lib/user-llm-api-key-guard";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { useUserSettingsModalOptional } from "@/components/layout/UserSettingsModalProvider";
import { ApiModelChoiceModal } from "@/components/ApiModelChoiceModal";

const API_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];

const LABELS: Record<AiProvider, string> = {
  claude: "Claude API",
  openai: "ChatGPT API",
  gemini: "Gemini API",
  deepseek: "DeepSeek API",
};

type Props = {
  userPrompt: string;
  systemPrompt?: string;
  maxOutputTokens?: number;
  /** Called with model markdown/plain text when the API succeeds */
  onResult: (text: string) => void;
  /**
   * When set, invoked after a successful API response (after `onResult`).
   * Use to persist the answer to the tab's saved-response store; throws to show an error under the buttons.
   */
  persistAfterResult?: (text: string) => void | Promise<void>;
  className?: string;
};

export function TabPromptApiButtons({
  userPrompt,
  systemPrompt,
  maxOutputTokens = 8192,
  onResult,
  persistAfterResult,
  className = "",
}: Props) {
  const [pending, setPending] = useState<AiProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [modelPickProvider, setModelPickProvider] = useState<AiProvider | null>(null);
  const { data: session } = useSession();
  const { preferences } = useUserPreferences();
  const settingsModal = useUserSettingsModalOptional();

  const executeRun = useCallback(
    async (provider: AiProvider, choice: ModelRunChoice) => {
      const trimmed = userPrompt.trim();
      if (!trimmed) return;
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
            ...modelPayloadForRun(provider, choice),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
        if (!res.ok || data.ok !== true || typeof data.text !== "string") {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        onResult(data.text);
        if (persistAfterResult) {
          await persistAfterResult(data.text);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "API request failed");
      } finally {
        setPending(null);
      }
    },
    [userPrompt, systemPrompt, maxOutputTokens, onResult, persistAfterResult]
  );

  const beginRun = useCallback(
    (provider: AiProvider) => {
      const trimmed = userPrompt.trim();
      if (!trimmed || pending) return;
      const email = session?.user?.email;
      if (!userHasCloudApiKeyForProvider(provider, email, preferences)) {
        setError(USER_LLM_API_KEYS_POLICY);
        settingsModal?.openSettings({ focus: "api-keys" });
        return;
      }
      setModelPickProvider(provider);
    },
    [userPrompt, pending, session?.user?.email, preferences, settingsModal]
  );

  const noPrompt = !userPrompt.trim();

  return (
    <div className={className}>
      <ApiModelChoiceModal
        open={modelPickProvider !== null}
        provider={modelPickProvider}
        onCancel={() => setModelPickProvider(null)}
        onConfirm={(choice) => {
          const p = modelPickProvider;
          setModelPickProvider(null);
          if (p) void executeRun(p, choice);
        }}
      />
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Or run via API (BYOK in User Settings — hosted accounts use server keys)
      </div>
      <div className="tab-prompt-ai-actions-grid">
        {API_PROVIDERS.map((p) => {
          const sel = AI_PROVIDER_CHIP_SELECTED[p];
          const isPending = pending === p;
          const inactiveWhileOtherRuns = pending !== null && pending !== p;
          const blockedByModal = modelPickProvider !== null;
          return (
            <button
              key={p}
              type="button"
              disabled={noPrompt || inactiveWhileOtherRuns || blockedByModal}
              onClick={() => beginRun(p)}
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
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
