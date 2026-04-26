"use client";

import type { ReactNode } from "react";

import type { CreditMemoProject, SourceFileRecord } from "@/lib/creditMemo/types";

/** Files actually sent to the indexed source pack — excludes Excel, oversized, memo/deck outputs, etc. */
function sourcesShownInInventory(sources: SourceFileRecord[]): SourceFileRecord[] {
  return sources.filter((s) => s.parseStatus !== "skipped");
}

function sourceInventoryRows(project: CreditMemoProject) {
  const listed = sourcesShownInInventory(project.sources);
  const rows = listed.map((s) => ({
    key: s.id,
    label: s.relPath,
    chars: s.charExtracted,
  }));
  const totalChars = listed.reduce((acc, s) => acc + s.charExtracted, 0);
  return { rows, totalChars, listedCount: listed.length };
}

export type SourceInventoryPanelProps = {
  project: CreditMemoProject | null;
  resolveFailed: { error: string } | null;
  ingestError: string | null;
  needsSignIn: boolean;
  /** Override default empty-state copy (e.g. AI Memo names the refresh button differently). */
  emptyHint?: ReactNode;
  /** Optional note below warnings (e.g. KPI tab explaining what is included in ingest). */
  footnote?: ReactNode;
  /** When a finite number, the header appends UTF-8 byte length of the system + user prompts last sent to the model. */
  lastModelContextUtf8Bytes?: number | null;
  listMaxHeightClass?: string;
  className?: string;
};

export function SourceInventoryPanel({
  project,
  resolveFailed,
  ingestError,
  needsSignIn,
  emptyHint,
  footnote,
  lastModelContextUtf8Bytes,
  listMaxHeightClass = "max-h-48",
  className,
}: SourceInventoryPanelProps) {
  const inv = project ? sourceInventoryRows(project) : null;
  const hasScannedFiles = Boolean(project && project.sources.length > 0);
  const hasListedFiles = Boolean(inv && inv.rows.length > 0);

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
      <div
        className="px-3 py-2 font-semibold"
        style={{ background: "var(--card2)", color: "var(--muted2)" }}
        title={
          typeof lastModelContextUtf8Bytes === "number"
            ? "UTF-8 byte length of the system + user prompt strings last sent to the model for this tab (after building inventory and evidence)."
            : undefined
        }
      >
        {inv
          ? (() => {
              const base = `Source inventory (${inv.listedCount} indexed file${inv.listedCount === 1 ? "" : "s"}, ${inv.totalChars.toLocaleString()} characters from indexed text`;
              if (typeof lastModelContextUtf8Bytes === "number") {
                return `${base}. Last model prompt: ${lastModelContextUtf8Bytes.toLocaleString()} UTF-8 bytes.)`;
              }
              return `${base})`;
            })()
          : "Source inventory"}
      </div>
      {inv && hasListedFiles ? (
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
      {inv && hasScannedFiles && !hasListedFiles ? (
        <p className="px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
          No files were indexed for the model in this ingest (e.g. only excluded types such as Excel workbooks). See warnings below.
        </p>
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
      {!hasScannedFiles && !needsSignIn && !resolveFailed && !ingestError ? (
        emptyHint ?? defaultEmpty
      ) : null}
      {project && hasScannedFiles ? (
        <p className="px-3 py-2 text-[11px] border-t" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          {inv?.listedCount ?? 0} indexed file{(inv?.listedCount ?? 0) === 1 ? "" : "s"} — {project.chunks.length} chunks. Warnings:{" "}
          {project.ingestWarnings?.length ? project.ingestWarnings.join("; ") : "none"}
        </p>
      ) : null}
      {footnote ? (
        <div className="px-3 py-2 text-[11px] border-t leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          {footnote}
        </div>
      ) : null}
    </div>
  );
}
