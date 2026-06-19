"use client";

import type { ReactNode } from "react";
import type { AiProvider } from "@/lib/ai-provider";
import {
  countMissingOnlyRunSteps,
  type BulkUpdateConfirmChoice,
  type BulkUpdatePreflightResult,
} from "@/lib/bulk-update-preflight";

const PROVIDER_LABEL: Record<AiProvider, string> = {
  claude: "Claude API",
  openai: "ChatGPT API",
  gemini: "Gemini API",
  deepseek: "DeepSeek API",
};

type Props = {
  open: boolean;
  provider: AiProvider;
  targetLabel: string;
  preflight: BulkUpdatePreflightResult | null;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (choice: BulkUpdateConfirmChoice) => void;
};

function StepList({
  title,
  labels,
  empty,
}: {
  title: string;
  labels: string[];
  empty: string;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {title} ({labels.length})
      </div>
      <div
        className="rounded border px-2.5 py-2 text-[11px] leading-relaxed"
        style={{ borderColor: "var(--border2)", background: "var(--panel)", color: "var(--text)" }}
      >
        {labels.length === 0 ? (
          <span style={{ color: "var(--muted2)" }}>{empty}</span>
        ) : (
          <ul className="list-disc pl-4">
            {labels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function PhasePanel({
  step,
  title,
  description,
  accent,
  children,
}: {
  step: 1 | 2;
  title: string;
  description: string;
  accent: "sources" | "work-product";
  children: ReactNode;
}) {
  const accentColor = accent === "sources" ? "var(--accent)" : "var(--warn)";
  const accentBg =
    accent === "sources"
      ? "color-mix(in srgb, var(--accent) 10%, var(--card2))"
      : "color-mix(in srgb, var(--warn) 10%, var(--card2))";

  return (
    <section
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border"
      style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
    >
      <div
        className="border-b px-3.5 py-3"
        style={{
          borderColor: "var(--border2)",
          background: accentBg,
          borderLeft: `3px solid ${accentColor}`,
        }}
      >
        <div className="flex items-start gap-2.5">
          <span
            className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
            style={{ background: accentColor, color: "var(--accent-fg)" }}
            aria-hidden
          >
            {step}
          </span>
          <div className="min-w-0">
            <h4 className="text-xs font-semibold leading-snug" style={{ color: "var(--text)" }}>
              {title}
            </h4>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
              {description}
            </p>
          </div>
        </div>
      </div>
      <div className="min-h-0 flex-1 space-y-4 px-3.5 py-3">{children}</div>
    </section>
  );
}

export function BulkUpdatePreflightModal({
  open,
  provider,
  targetLabel,
  preflight,
  loading = false,
  onCancel,
  onConfirm,
}: Props) {
  if (!open) return null;

  const who = PROVIDER_LABEL[provider];
  const sourceSaved =
    preflight?.steps.filter((s) => s.phase === "sources" && s.complete).map((s) => s.label) ?? [];
  const sourceMissing =
    preflight?.steps.filter((s) => s.phase === "sources" && !s.complete).map((s) => s.label) ?? [];
  const workProducts =
    preflight?.steps.filter((s) => s.phase === "work-product").map((s) => s.label) ?? [];
  const workProductsWithOutput =
    preflight?.steps.filter((s) => s.phase === "work-product" && s.complete).map((s) => s.label) ?? [];

  const sourcesMissingCount = preflight?.sourcesMissingCount ?? 0;
  const workProductCount = preflight?.workProductCount ?? 0;
  const total = preflight?.total ?? 0;
  const runWithRefresh = preflight ? countMissingOnlyRunSteps(preflight, true) : 0;
  const runSourcesOnly = preflight ? countMissingOnlyRunSteps(preflight, false) : 0;

  return (
    <div
      className="fixed inset-0 z-[420] flex items-center justify-center px-3 py-8"
      style={{ background: "rgba(0,0,0,0.65)" }}
      role="presentation"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-preflight-title"
        className="flex max-h-[min(92vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-xl border shadow-xl"
        style={{ background: "var(--panel)", borderColor: "var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-4 py-3" style={{ borderColor: "var(--border2)" }}>
          <h3 id="bulk-preflight-title" className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Update all via {who}
          </h3>
          <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            {loading
              ? `Checking saved responses for ${targetLabel}…`
              : `Two phases: gather source material first (${preflight?.sourcesCompleteCount ?? 0}/${preflight?.sourcesTotal ?? 0} saved), then refresh analyst work products (${workProductCount} tabs).`}
          </p>
        </div>

        {loading || !preflight ? (
          <div className="px-4 py-8 text-center text-sm" style={{ color: "var(--muted2)" }}>
            Checking tabs…
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <div className="grid min-h-[min(52vh,520px)] grid-cols-1 gap-4 sm:grid-cols-2">
              <PhasePanel
                step={1}
                title="Information gathered"
                description="Raw research from filings, transcripts, credit docs, and Excel. These tabs collect source material and run first."
                accent="sources"
              >
                <StepList
                  title="Already saved"
                  labels={sourceSaved}
                  empty="None yet."
                />
                <StepList
                  title="Not saved yet"
                  labels={sourceMissing}
                  empty="All source-gathering steps are saved."
                />
              </PhasePanel>

              <PhasePanel
                step={2}
                title="Work products"
                description="Analyst deliverables built from gathered material — KPI, forensic, LME, credit memo, etc. These refresh after step 1."
                accent="work-product"
              >
                {workProductsWithOutput.length > 0 ? (
                  <p className="shrink-0 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
                    {workProductsWithOutput.length} of {workProductCount} already have output and will be re-run when
                    you choose to refresh work products.
                  </p>
                ) : null}
                <StepList
                  title="Tabs to refresh"
                  labels={workProducts}
                  empty="No work-product steps."
                />
              </PhasePanel>
            </div>

            <p className="mt-3 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
              Full runs usually take 45–90+ minutes with pauses between API calls.
            </p>
          </div>
        )}

        <div
          className="flex shrink-0 flex-col gap-2 border-t px-4 py-3 sm:flex-row sm:flex-wrap sm:justify-end"
          style={{ borderColor: "var(--border2)" }}
        >
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="rounded border px-3 py-2 text-xs font-semibold"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
          >
            Cancel
          </button>
          {runSourcesOnly > 0 && sourcesMissingCount > 0 ? (
            <button
              type="button"
              disabled={loading || !preflight}
              onClick={() => onConfirm({ mode: "missing-only", refreshWorkProducts: false })}
              className="rounded border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
            >
              Missing info only ({runSourcesOnly})
            </button>
          ) : null}
          {runWithRefresh > 0 ? (
            <button
              type="button"
              disabled={loading || !preflight}
              onClick={() => onConfirm({ mode: "missing-only", refreshWorkProducts: true })}
              className="rounded border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {sourcesMissingCount > 0
                ? `Update missing info + refresh work products (${runWithRefresh})`
                : `Refresh work products (${runWithRefresh})`}
            </button>
          ) : null}
          <button
            type="button"
            disabled={loading || !preflight}
            onClick={() => onConfirm({ mode: "overwrite-all", refreshWorkProducts: true })}
            className="rounded border px-3 py-2 text-xs font-semibold"
            style={{
              borderColor: (preflight?.completeCount ?? 0) > 0 ? "var(--warn)" : "var(--accent)",
              color: (preflight?.completeCount ?? 0) > 0 ? "var(--warn)" : "var(--accent)",
              background: "transparent",
            }}
          >
            {(preflight?.completeCount ?? 0) > 0 ? `Update all & overwrite (${total})` : `Update all (${total})`}
          </button>
        </div>
      </div>
    </div>
  );
}
