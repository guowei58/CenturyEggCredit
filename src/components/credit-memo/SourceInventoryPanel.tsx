"use client";

import type { ReactNode } from "react";

import type { CreditMemoProject } from "@/lib/creditMemo/types";

function sourceInventoryRows(project: CreditMemoProject) {
  const rows = project.sources.map((s) => ({
    key: s.id,
    label: s.relPath,
    chars: s.charExtracted,
  }));
  const totalChars = project.sources.reduce((acc, s) => acc + s.charExtracted, 0);
  return { rows, totalChars };
}

export type SourceInventoryPanelProps = {
  project: CreditMemoProject | null;
  resolveFailed: { error: string } | null;
  ingestError: string | null;
  needsSignIn: boolean;
  /** Override default empty-state copy (e.g. AI Memo names the refresh button differently). */
  emptyHint?: ReactNode;
  listMaxHeightClass?: string;
  className?: string;
};

export function SourceInventoryPanel({
  project,
  resolveFailed,
  ingestError,
  needsSignIn,
  emptyHint,
  listMaxHeightClass = "max-h-48",
  className,
}: SourceInventoryPanelProps) {
  const inv = project ? sourceInventoryRows(project) : null;
  const hasSubstantiveSources = Boolean(project && project.sources.length > 0);

  const defaultEmpty = (
    <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
      No indexed files yet. Click <strong>Refresh sources</strong> after signing in, or wait for the automatic resolve on first load.
    </p>
  );

  return (
    <div
      className={`rounded border text-xs ${className ?? ""}`}
      style={{ borderColor: "var(--border2)" }}
    >
      <div className="px-3 py-2 font-semibold" style={{ background: "var(--card2)", color: "var(--muted2)" }}>
        {inv
          ? `Source inventory (${inv.rows.length} files, ${inv.totalChars.toLocaleString()} characters from indexed text)`
          : "Source inventory"}
      </div>
      {inv ? (
        <ul className={`${listMaxHeightClass} overflow-y-auto divide-y`} style={{ borderColor: "var(--border2)" }}>
          {inv.rows.map((s) => (
            <li
              key={s.key}
              className="px-3 py-1.5 flex justify-between gap-2"
              style={{ color: "var(--text)" }}
            >
              <span className="min-w-0 truncate font-mono text-[11px]" title={s.label}>
                {s.label}
              </span>
              <span className="font-mono flex-shrink-0 text-[11px]" style={{ color: "var(--muted)" }}>
                {s.chars.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {resolveFailed ? (
        <p className="px-3 py-2 text-[11px]" style={{ color: "var(--warn)" }}>
          {resolveFailed.error}
        </p>
      ) : null}
      {ingestError ? (
        <p className="px-3 py-2 text-[11px]" style={{ color: "var(--warn)" }}>
          {ingestError}
        </p>
      ) : null}
      {!hasSubstantiveSources && !needsSignIn && !resolveFailed && !ingestError ? (
        emptyHint ?? defaultEmpty
      ) : null}
      {project && hasSubstantiveSources ? (
        <p className="px-3 py-2 text-[11px] border-t" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          {project.sources.length} files — {project.chunks.length} chunks. Warnings:{" "}
          {project.ingestWarnings?.length ? project.ingestWarnings.join("; ") : "none"}
        </p>
      ) : null}
    </div>
  );
}
