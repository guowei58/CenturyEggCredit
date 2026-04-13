"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import {
  aiChatShowsUnreadNavDot,
  fetchAiChatStateFromServer,
  getAiChatLastSeenIso,
  OREO_AI_CHAT_WAITING_REPLY_KEY,
} from "@/lib/ai-chat-sessions";
import { AI_CHAT_NAV_ICON_FRAME_CLASSNAME } from "./EggHocCommitteeMark";
import { runBulkUpdateViaApi } from "@/lib/bulk-ai-open";
import { type AiProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { GEMINI_UI_BUTTON_COLOR } from "@/lib/gemini-open-url";
import type { ModelRunChoice } from "@/lib/ai-model-prefs-client";
import { userHasCloudApiKeyForProvider } from "@/lib/user-llm-api-key-guard";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { useUserSettingsModalOptional } from "@/components/layout/UserSettingsModalProvider";
import { ApiModelChoiceModal } from "@/components/ApiModelChoiceModal";

const DEEPSEEK_BULK_COLOR = "#2563eb";

const AI_CHAT_BADGE_POLL_MS = 10_000;

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
  aiChatOpen = false,
  onOpenAiChat,
}: {
  data: CompanyBarData;
  /** Resolved company name for prompt substitution (may match `data.name` or be null while loading). */
  companyNameForPrompts?: string | null;
  /** When true, hide the unread dot for this ticker’s AI Chat. */
  aiChatOpen?: boolean;
  onOpenAiChat?: () => void;
}) {
  const [bulkApiBusy, setBulkApiBusy] = useState<AiProvider | null>(null);
  const [bulkApiLine, setBulkApiLine] = useState<string | null>(null);
  const [bulkModelPick, setBulkModelPick] = useState<AiProvider | null>(null);
  const [aiChatNavUnread, setAiChatNavUnread] = useState(false);
  const { data: session, status: sessionStatus } = useSession();
  const { preferences } = useUserPreferences();
  const settingsModal = useUserSettingsModalOptional();
  const email = session?.user?.email ?? null;

  /** Returns true if the bulk API action may proceed; otherwise opens settings. */
  function bulkApiAllowedOrPrompt(provider: AiProvider): boolean {
    if (!userHasCloudApiKeyForProvider(provider, email, preferences)) {
      settingsModal?.openSettings({ focus: "api-keys" });
      return false;
    }
    return true;
  }

  useEffect(() => {
    if (!onOpenAiChat || sessionStatus !== "authenticated") {
      setAiChatNavUnread(false);
      return;
    }
    const tk = data.ticker.trim().toUpperCase();
    if (!tk) {
      setAiChatNavUnread(false);
      return;
    }

    const refresh = async () => {
      if (aiChatOpen) {
        setAiChatNavUnread(false);
        return;
      }
      let aiUnread = false;
      try {
        if (typeof sessionStorage !== "undefined" && sessionStorage.getItem(OREO_AI_CHAT_WAITING_REPLY_KEY) === "1") {
          aiUnread = true;
        }
      } catch {
        /* ignore */
      }
      if (!aiUnread) {
        const st = await fetchAiChatStateFromServer(tk);
        if (st) {
          aiUnread = aiChatShowsUnreadNavDot(st.sessions, getAiChatLastSeenIso(tk));
        }
      }
      setAiChatNavUnread(aiUnread);
    };

    void refresh();
    const id = window.setInterval(() => void refresh(), AI_CHAT_BADGE_POLL_MS);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [sessionStatus, data.ticker, aiChatOpen, onOpenAiChat]);

  function bulkCtx() {
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return {
      ticker: data.ticker,
      companyName: companyNameForPrompts ?? data.name,
      appOrigin: origin,
    };
  }

  function startBulkApi(provider: AiProvider) {
    if (bulkApiBusy || !data.ticker.trim()) return;
    if (!bulkApiAllowedOrPrompt(provider)) return;
    setBulkModelPick(provider);
  }

  async function continueBulkApiAfterModel(provider: AiProvider, choice: ModelRunChoice) {
    const who =
      provider === "claude"
        ? "Claude API"
        : provider === "openai"
          ? "ChatGPT API"
          : provider === "gemini"
            ? "Gemini API"
            : "DeepSeek API";
    const ok = window.confirm(
      `${who} will run all research prompts for ${data.ticker.toUpperCase()} and overwrite (save over) any existing saved answers in those tabs.\n\nThis usually takes a long time—about 20–30 minutes in most situations—because each tab is run separately with pauses to respect API rate limits.\n\nContinue?`
    );
    if (!ok) return;
    setBulkApiBusy(provider);
    setBulkApiLine(null);
    try {
      const r = await runBulkUpdateViaApi(
        bulkCtx(),
        provider,
        (p) => {
          setBulkApiLine(`${who}: ${p.index}/${p.total} — ${p.label}`);
        },
        choice
      );
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
      <ApiModelChoiceModal
        open={bulkModelPick !== null}
        provider={bulkModelPick}
        confirmLabel="Continue"
        onCancel={() => setBulkModelPick(null)}
        onConfirm={(choice) => {
          const p = bulkModelPick;
          setBulkModelPick(null);
          if (p) void continueBulkApiAfterModel(p, choice);
        }}
      />
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between lg:gap-8">
        <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 sm:gap-3.5">
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
          {onOpenAiChat ? (
            <button
              type="button"
              className="btn-shell hi relative flex min-h-9 shrink-0 items-center justify-center gap-1.5 px-3 py-2 text-[11px] font-semibold sm:min-h-10 sm:px-4 sm:text-xs"
              onClick={onOpenAiChat}
              aria-label={aiChatNavUnread ? `AI Chat for ${data.ticker} (unread)` : `AI Chat for ${data.ticker}`}
            >
              {aiChatNavUnread ? (
                <span
                  className="absolute right-0.5 top-0.5 size-2 rounded-full bg-red-500 ring-2 ring-[var(--sb)]"
                  aria-hidden
                />
              ) : null}
              <span className={AI_CHAT_NAV_ICON_FRAME_CLASSNAME} aria-hidden="true">
                <img src="/ai-chat-icon.png" alt="" className="size-5 rounded sm:size-6" />
              </span>
              <span className="hidden sm:inline">AI Chat</span>
            </button>
          ) : null}
        </div>

        <div className="min-w-0 w-full lg:max-w-[min(100%,52rem)] lg:flex-1">
          <div className="flex flex-col gap-2">
            <div
              className="grid w-full grid-cols-2 gap-2 sm:gap-2.5 md:grid-cols-4 md:items-stretch"
              onPointerDownCapture={(e) => {
                const btn = (e.target as HTMLElement).closest("button[data-bulk-api]");
                if (!btn) return;
                const p = normalizeAiProvider(btn.getAttribute("data-bulk-api"));
                if (!p) return;
                if (bulkApiAllowedOrPrompt(p)) return;
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <button
                type="button"
                className={bulkBarBtnClass}
                data-bulk-api="claude"
                disabled={bulkApiBusy !== null || bulkModelPick !== null}
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                title="Runs every research prompt through the Claude API and saves each answer to the matching tab (your key in User Settings, or a hosted account). Pauses ~10s between tabs and retries on rate limits—expect several minutes for a full run."
                onClick={() => void startBulkApi("claude")}
              >
                Update all via Claude API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                data-bulk-api="openai"
                disabled={bulkApiBusy !== null || bulkModelPick !== null}
                style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
                title="Runs every research prompt through the OpenAI API and saves each answer to the matching tab (your key in User Settings, or a hosted account). Pauses ~10s between tabs and retries on rate limits—expect several minutes for a full run."
                onClick={() => void startBulkApi("openai")}
              >
                Update all via ChatGPT API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                data-bulk-api="gemini"
                disabled={bulkApiBusy !== null || bulkModelPick !== null}
                style={{ borderColor: GEMINI_UI_BUTTON_COLOR, color: GEMINI_UI_BUTTON_COLOR }}
                title="Runs every research prompt through the Gemini API and saves each answer to the matching tab (your key in User Settings, or a hosted account). Pauses ~10s between tabs and retries on rate limits—expect several minutes for a full run."
                onClick={() => void startBulkApi("gemini")}
              >
                Update all via Gemini API
              </button>
              <button
                type="button"
                className={bulkBarBtnClass}
                data-bulk-api="deepseek"
                disabled={bulkApiBusy !== null || bulkModelPick !== null}
                style={{ borderColor: DEEPSEEK_BULK_COLOR, color: DEEPSEEK_BULK_COLOR }}
                title="Runs every research prompt through the DeepSeek API and saves each answer (your key in User Settings, or a hosted account). Pauses ~10s between tabs and retries on rate limits—expect several minutes for a full run."
                onClick={() => void startBulkApi("deepseek")}
              >
                Update all via DeepSeek API
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
