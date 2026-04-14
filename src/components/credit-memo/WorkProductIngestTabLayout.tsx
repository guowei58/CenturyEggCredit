"use client";

import type { ReactNode } from "react";

import { Card } from "@/components/ui";
import { SavedRichText } from "@/components/SavedRichText";
import { AiProviderChipRow } from "@/components/credit-memo/AiProviderChipRow";
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
};

export function WorkProductIngestTabLayout({
  tabTitle,
  ticker,
  description,
  needsSignIn,
  refreshingSources,
  hasProject,
  aiProvider,
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

        <p className="text-[11px] leading-relaxed mb-4" style={{ color: "var(--muted2)" }}>
          {description}
        </p>

        {needsSignIn && (
          <p className="text-xs mb-4 rounded border px-3 py-2" style={{ borderColor: "var(--warn)", color: "var(--muted2)" }}>
            Sign in to resolve your ticker workspace, ingest sources, and run generation. Saved output is stored per account.
          </p>
        )}

        <AiProviderChipRow aiProvider={aiProvider} onProviderChange={onProviderChange} />

        <div className="flex flex-wrap items-center gap-3 mb-4">
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
          <p className="text-xs mb-3" style={{ color: "var(--danger)" }}>
            {genError}
          </p>
        ) : null}

        <SourceInventoryPanel
          className="mb-4"
          project={project}
          resolveFailed={resolveFailed}
          ingestError={ingestError}
          needsSignIn={needsSignIn}
        />

        {jobId ? (
          <p className="text-[10px] mb-1 font-mono" style={{ color: "var(--muted)" }}>
            Job: {jobId}
          </p>
        ) : null}
      </Card>

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
