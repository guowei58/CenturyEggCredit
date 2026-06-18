"use client";

import type { ReactNode } from "react";

const STEP_CIRCLE =
  "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold tabular-nums";

const STEP_BUTTON =
  "rounded-md border px-3 py-1.5 text-lg font-semibold tracking-tight transition disabled:cursor-not-allowed disabled:opacity-50";

export type WorkProductStepToolbarProps = {
  needsSignIn?: boolean;
  signInMessage?: ReactNode;
  refreshLoading?: boolean;
  refreshDisabled?: boolean;
  refreshLabel?: string;
  onRefresh: () => void;
  refreshTitle?: string;
  buildLoading?: boolean;
  buildDisabled?: boolean;
  onBuild: () => void;
  buildTitle?: string;
  runDisabled?: boolean;
  onRunThroughAi: () => void;
  runTitle?: string;
  error?: string | null;
  warning?: ReactNode;
  /** Source inventory, memo settings, etc. */
  children?: ReactNode;
  /** Memo type picker, product selector, etc. */
  header?: ReactNode;
};

export function WorkProductStepToolbar({
  needsSignIn = false,
  signInMessage = "Sign in to load saved sources, build the context window, and save responses.",
  refreshLoading = false,
  refreshDisabled = false,
  refreshLabel = "Refresh sources",
  onRefresh,
  refreshTitle = "Rescan saved sources for this tab",
  buildLoading = false,
  buildDisabled = false,
  onBuild,
  buildTitle = "Assemble the full prompt with packed sources",
  runDisabled = true,
  onRunThroughAi,
  runTitle = "Open the prompt panel to copy or run in Claude, ChatGPT, Gemini, or DeepSeek",
  error,
  warning,
  children,
  header,
}: WorkProductStepToolbarProps) {
  return (
    <div className="space-y-3">
      {header}
      {needsSignIn ? (
        <p className="text-xs rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
          {signInMessage}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex items-center gap-3">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            1
          </span>
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled}
            className={STEP_BUTTON}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            title={refreshTitle}
          >
            {refreshLoading ? "Refreshing…" : refreshLabel}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            2
          </span>
          <button
            type="button"
            onClick={onBuild}
            disabled={buildDisabled}
            className={STEP_BUTTON}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            title={buildTitle}
          >
            {buildLoading ? "Building…" : "Build context window"}
          </button>
        </div>
        <div className="flex items-center gap-3">
          <span className={STEP_CIRCLE} style={{ background: "var(--accent)", color: "#fff" }}>
            3
          </span>
          <button
            type="button"
            onClick={onRunThroughAi}
            disabled={runDisabled}
            className={STEP_BUTTON}
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            title={runDisabled ? "Complete step 2 first" : runTitle}
          >
            Run through AI
          </button>
        </div>
      </div>
      {error ? (
        <p className="text-xs" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
      {warning}
      {children}
    </div>
  );
}
