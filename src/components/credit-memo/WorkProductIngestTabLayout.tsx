"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { AiProviderChipRow } from "@/components/credit-memo/AiProviderChipRow";
import { ProviderPublicLimitsSidePanel } from "@/components/credit-memo/ProviderPublicLimitsSidePanel";
import { SourceInventoryPanel } from "@/components/credit-memo/SourceInventoryPanel";
import type { AiProvider } from "@/lib/ai-provider";
import type { CreditMemoProject } from "@/lib/creditMemo/types";

export type WorkProductIngestTabLayoutProps = {
  tabTitle: string;
  ticker: string;
  description: ReactNode;
  needsSignIn: boolean;
  refreshingSources: boolean;
  hasProject: boolean;
  aiProvider: AiProvider;
  /** Resolved API model id from User Settings (same as memo routes); omit limits detail if unset. */
  resolvedModelId?: string | null;
  onProviderChange: (p: AiProvider) => void;
  onRefreshSources: () => void;
  refreshDisabled: boolean;
  refreshLabel: string;
  onRun: () => void;
  runDisabled: boolean;
  runBusy: boolean;
  runLabel: string;
  runLoadingLabel: string;
  resolveFailed: { error: string } | null;
  ingestError: string | null;
  genError: string | null;
  jobId: string | null;
  project: CreditMemoProject | null;
  outputCardTitle: string;
  markdown: string | null;
  emptyOutputMessage: ReactNode;
  /** Shown at the bottom of the source inventory panel (e.g. KPI ingest scope). */
  sourceInventoryFootnote?: ReactNode;
  /** KPI: UTF-8 size of last system+user prompt; omit on other tabs to keep token estimate in the header. */
  lastModelContextUtf8Bytes?: number | null;
  /** Rendered between the ingest card and the output card (e.g. forensic “last run” prompt panel). */
  lastRunSlot?: ReactNode;
};

export function WorkProductIngestTabLayout({
  tabTitle,
  ticker,
  description,
  needsSignIn,
  refreshingSources,
  hasProject,
  aiProvider,
  resolvedModelId,
  onProviderChange,
  onRefreshSources,
  refreshDisabled,
  refreshLabel,
  onRun,
  runDisabled,
  runBusy,
  runLabel,
  runLoadingLabel,
  resolveFailed,
  ingestError,
  genError,
  jobId,
  project,
  outputCardTitle,
  markdown,
  emptyOutputMessage,
  sourceInventoryFootnote,
  lastModelContextUtf8Bytes,
  lastRunSlot,
}: WorkProductIngestTabLayoutProps) {
  return (
    <div className="space-y-6">
      <Card title={`${tabTitle} — ${ticker}`}>
        {refreshingSources && hasProject ? (
          <p className="text-[11px] mb-3 flex items-center gap-2" style={{ color: "var(--muted)" }}>
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
            Refreshing sources…
          </p>
        ) : null}

        <div className="flex flex-col lg:flex-row lg:gap-6 lg:items-start">
          <div className="min-w-0 flex-1 space-y-4">
            <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
              {description}
            </p>

            {needsSignIn && (
              <p className="text-xs rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
                Sign in to resolve your ticker workspace, ingest sources, and run generation. Saved output is stored per account.
              </p>
            )}

            <AiProviderChipRow aiProvider={aiProvider} onProviderChange={onProviderChange} />

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => void onRun()}
                disabled={runBusy || runDisabled || needsSignIn}
                className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-50"
                style={{
                  borderColor: "var(--accent)",
                  color: "var(--accent)",
                  background: "transparent",
                }}
              >
                {runBusy ? runLoadingLabel : runLabel}
              </button>
              <button
                type="button"
                onClick={() => void onRefreshSources()}
                disabled={refreshDisabled || needsSignIn}
                className="rounded border px-3 py-2 text-xs font-medium disabled:opacity-50"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                {refreshLabel}
              </button>
            </div>

            {genError ? (
              <p className="text-xs" style={{ color: "var(--danger)" }}>
                {genError}
              </p>
            ) : null}

            <SourceInventoryPanel
              project={project}
              resolveFailed={resolveFailed}
              ingestError={ingestError}
              needsSignIn={needsSignIn}
              footnote={sourceInventoryFootnote}
              lastModelContextUtf8Bytes={lastModelContextUtf8Bytes}
            />

            {jobId ? (
              <p className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
                Job: {jobId}
              </p>
            ) : null}
          </div>

          <ProviderPublicLimitsSidePanel
            provider={aiProvider}
            resolvedModelId={resolvedModelId}
            className="w-full shrink-0 lg:sticky lg:top-4 lg:w-[min(100%,320px)]"
          />
        </div>
      </Card>

      {lastRunSlot}

      {markdown?.trim() ? (
        <Card title={outputCardTitle}>
          <div className="prose-covenants text-sm leading-relaxed max-w-none" style={{ color: "var(--text)" }}>
            <SavedRichText content={markdown} ticker={ticker} />
          </div>
        </Card>
      ) : (
        <Card title={outputCardTitle}>
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            {emptyOutputMessage}
          </p>
        </Card>
      )}
    </div>
  );
}
