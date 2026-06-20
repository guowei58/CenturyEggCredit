"use client";

import { useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { AiProvider } from "@/lib/ai-provider";
import { AI_PROVIDER_CHIP_SELECTED } from "@/lib/ai-provider";
import { modelPayloadForRun, type ModelRunChoice } from "@/lib/ai-model-prefs-client";
import type { SavedDataKey } from "@/lib/saved-data-client";
import { USER_LLM_API_KEYS_POLICY } from "@/lib/llm-user-key-messages";
import { userHasCloudApiKeyForProvider } from "@/lib/user-llm-api-key-guard";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { useUserSettingsModalOptional } from "@/components/layout/UserSettingsModalProvider";
import { ApiModelChoiceModal } from "@/components/ApiModelChoiceModal";
import type { LlmApiErrorReport } from "@/lib/llm-api-error-report";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";

const API_PROVIDERS: AiProvider[] = ["claude", "openai", "gemini", "deepseek"];

const LABELS: Record<AiProvider, string> = {
  claude: "Claude API",
  openai: "ChatGPT API",
  gemini: "Gemini API",
  deepseek: "DeepSeek API",
};

const TAB_API_RUN_HINT =
  "Runs can take several minutes. You can browse other tabs — the response auto-saves when finished. Keep this browser tab open (don't refresh or close it); return here to view the result.";

import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";

type Props = {
  userPrompt: string;
  systemPrompt?: string;
  /** Saved-tab key — selects canon vs delta output style on the server. */
  researchSaveKey?: SavedDataKey | string;
  /** Work-product kind — applies synthesis anti-restatement rules. */
  workProductKind?: WorkProductPromptKind;
  maxOutputTokens?: number;
  /**
   * Public paths under `/public` (e.g. `/org-chart-sample-lumen.png`) sent to the tab-prompt API
   * so vision models receive the reference screenshots. Must match app allowlist server-side.
   */
  samplePublicPaths?: readonly string[];
  /** Called with model markdown/plain text when the API succeeds */
  onResult: (text: string) => void;
  /**
   * When set, invoked after a successful API response (after `onResult`).
   * Use to persist the answer to the tab's saved-response store; throws to show an error under the buttons.
   */
  persistAfterResult?: (text: string) => void | Promise<void>;
  /** Called when the user starts a new API run (clicks a provider button). */
  onRunStart?: () => void;
  /** When true, show the full prompt for review and require Okay before calling the API (after model pick). */
  requirePromptReviewBeforeRun?: boolean;
  className?: string;
};

export function TabPromptApiButtons({
  userPrompt,
  systemPrompt,
  researchSaveKey,
  workProductKind,
  maxOutputTokens = LLM_MAX_OUTPUT_TOKENS,
  samplePublicPaths,
  onResult,
  persistAfterResult,
  onRunStart,
  requirePromptReviewBeforeRun = false,
  className = "",
}: Props) {
  const [pending, setPending] = useState<AiProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [modelPickProvider, setModelPickProvider] = useState<AiProvider | null>(null);
  const [promptReviewRun, setPromptReviewRun] = useState<{
    provider: AiProvider;
    choice: ModelRunChoice;
  } | null>(null);
  const { data: session } = useSession();
  const { preferences } = useUserPreferences();
  const settingsModal = useUserSettingsModalOptional();

  const executeRun = useCallback(
    async (provider: AiProvider, choice: ModelRunChoice) => {
      const trimmed = userPrompt.trim();
      if (!trimmed) return;
      setError(null);
      setWarning(null);
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
            ...(researchSaveKey ? { researchSaveKey } : {}),
            ...(workProductKind ? { workProductKind } : {}),
            ...(samplePublicPaths?.length ? { samplePublicPaths: [...samplePublicPaths] } : {}),
            ...modelPayloadForRun(provider, choice),
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          text?: string;
          error?: string;
          errorReport?: LlmApiErrorReport;
          warning?: string;
        };
        if (!res.ok || data.ok !== true || typeof data.text !== "string") {
          throw new Error(data.error || `Request failed (${res.status})`);
        }
        if (data.warning?.trim()) {
          setWarning(data.warning.trim());
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
    [userPrompt, systemPrompt, researchSaveKey, workProductKind, maxOutputTokens, samplePublicPaths, onResult, persistAfterResult]
  );

  const beginRun = useCallback(
    (provider: AiProvider) => {
      const trimmed = userPrompt.trim();
      if (!trimmed || pending) return;
      onRunStart?.();
      const email = session?.user?.email;
      if (!userHasCloudApiKeyForProvider(provider, email, preferences)) {
        setError(USER_LLM_API_KEYS_POLICY);
        settingsModal?.openSettings({ focus: "api-keys" });
        return;
      }
      setModelPickProvider(provider);
    },
    [userPrompt, pending, session?.user?.email, preferences, settingsModal, onRunStart]
  );

  const noPrompt = !userPrompt.trim();
  const blockedByModal = modelPickProvider !== null || promptReviewRun !== null;

  return (
    <div className={className}>
      {requirePromptReviewBeforeRun && promptReviewRun ? (
        <div
          className="fixed inset-0 z-[415] flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.55)" }}
          role="dialog"
          aria-modal="true"
          aria-label="Review prompt before API run"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPromptReviewRun(null);
          }}
        >
          <div
            className="flex max-h-[min(90vh,720px)] w-full max-w-2xl flex-col overflow-hidden rounded-xl border shadow-xl"
            style={{ background: "var(--panel)", borderColor: "var(--border)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
              <h3 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                Review prompt
              </h3>
              <p className="mt-1 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                Confirm the prompt below, then click Okay to send it to {LABELS[promptReviewRun.provider]}.
              </p>
            </div>
            <div
              className="min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap"
              style={{ color: "var(--text)", background: "var(--card2)" }}
            >
              {userPrompt}
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3" style={{ borderColor: "var(--border2)" }}>
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
                onClick={() => setPromptReviewRun(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
                onClick={() => {
                  const run = promptReviewRun;
                  setPromptReviewRun(null);
                  if (run) void executeRun(run.provider, run.choice);
                }}
              >
                Okay
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <ApiModelChoiceModal
        open={modelPickProvider !== null}
        provider={modelPickProvider}
        onCancel={() => setModelPickProvider(null)}
        onConfirm={(choice) => {
          const p = modelPickProvider;
          setModelPickProvider(null);
          if (!p) return;
          if (requirePromptReviewBeforeRun) {
            setPromptReviewRun({ provider: p, choice });
            return;
          }
          void executeRun(p, choice);
        }}
      />
      <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
        Or run via API (BYOK in User Settings — hosted accounts use server keys)
      </div>
      {pending ? (
        <p className="mb-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
          <span style={{ color: "var(--accent)" }}>{LABELS[pending]} running… </span>
          {TAB_API_RUN_HINT}
        </p>
      ) : null}
      <div className="tab-prompt-ai-actions-grid">
        {API_PROVIDERS.map((p) => {
          const sel = AI_PROVIDER_CHIP_SELECTED[p];
          const isPending = pending === p;
          const inactiveWhileOtherRuns = pending !== null && pending !== p;
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
      {warning ? (
        <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed" style={{ color: "var(--warn)" }}>
          {warning}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 whitespace-pre-line text-[11px] leading-relaxed" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
