"use client";

import type { ReactNode } from "react";

import type { LmeDocumentPackedRow } from "@/lib/lme-sources";

export type WorkProductSourceInventoryRow = {
  label: string;
  key?: string;
  file?: string;
  charsInitial: number;
  truncated?: boolean;
  isBinaryPlaceholder?: boolean;
};

function lookupPackedRow(
  row: WorkProductSourceInventoryRow,
  documentRows: LmeDocumentPackedRow[]
): LmeDocumentPackedRow | undefined {
  if (row.key) {
    const byKey = documentRows.find((d) => d.key === row.key);
    if (byKey) return byKey;
  }
  if (row.file) {
    const byFile = documentRows.find((d) => d.file === row.file);
    if (byFile) return byFile;
  }
  const byLabel = documentRows.find((d) => d.label === row.label);
  if (byLabel) return byLabel;
  const rowFile = row.label.split(" — ").pop()?.trim();
  if (rowFile) {
    return documentRows.find((d) => d.file === rowFile || d.label.endsWith(rowFile));
  }
  return undefined;
}

export function sumDocumentPackedChars(documentRows: LmeDocumentPackedRow[] | null | undefined): number {
  if (!documentRows?.length) return 0;
  return documentRows.reduce((s, d) => s + d.packedChars, 0);
}

export function workProductRowsHaveChunkCounts(documentRows: LmeDocumentPackedRow[] | null | undefined): boolean {
  return Boolean(documentRows?.some((d) => d.packedChars > 0 && (d.chunksInWindow ?? 0) > 0));
}

export function WorkProductSourceInventoryTable({
  rows,
  documentRows,
  emptyHint,
  buildPendingHint,
  contextSummary,
}: {
  rows: WorkProductSourceInventoryRow[];
  documentRows?: LmeDocumentPackedRow[] | null;
  emptyHint?: ReactNode;
  /** Shown when refresh inventory exists but step 2 has not been run for this fingerprint. */
  buildPendingHint?: ReactNode;
  /** One-line summary from the last context build (mode, cap, chunk count). */
  contextSummary?: string | null;
}) {
  const showPacked = Boolean(documentRows?.length);
  const showChunks = workProductRowsHaveChunkCounts(documentRows);

  const gridCols = showPacked
    ? showChunks
      ? "grid-cols-[minmax(0,1fr)_4rem_4.5rem_3rem] sm:grid-cols-[minmax(0,1fr)_4.75rem_5rem_3.5rem]"
      : "grid-cols-[minmax(0,1fr)_4.25rem_4.75rem] sm:grid-cols-[minmax(0,1fr)_5rem_5.5rem]"
    : "grid-cols-[minmax(0,1fr)_5.5rem] sm:grid-cols-[minmax(0,1fr)_6.75rem]";

  return (
    <>
      {contextSummary ? (
        <p className="border-b px-3 py-2 text-[10px] leading-relaxed" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          Last context build: {contextSummary}
        </p>
      ) : null}
      <div
        className={`grid gap-x-2 border-b px-3 py-1.5 text-[9px] font-semibold sm:text-[10px] ${gridCols}`}
        style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
      >
        <span>Source</span>
        <span className="text-right">{showPacked ? "Available" : "Chars"}</span>
        {showPacked ? <span className="text-right">In context</span> : null}
        {showPacked && showChunks ? <span className="text-right">Chunks</span> : null}
      </div>
      <ul className="max-h-48 overflow-y-auto divide-y" style={{ borderColor: "var(--border2)" }}>
        {rows.map((s) => {
          const packedRow = showPacked && documentRows ? lookupPackedRow(s, documentRows) : undefined;
          const packedChars = packedRow?.packedChars ?? null;
          const chunksInWindow = packedRow?.chunksInWindow;
          const omitted = packedChars === 0;
          const partial =
            packedChars != null && packedChars > 0 && packedChars < s.charsInitial;
          return (
            <li
              key={`${s.label}-${s.key ?? ""}-${s.charsInitial}`}
              className={`grid gap-x-2 px-3 py-1.5 ${gridCols}`}
              style={{ color: "var(--text)" }}
            >
              <span className="min-w-0 truncate" title={s.label}>
                {s.label}
                {s.truncated && !showPacked ? " · truncated" : null}
                {partial ? " · partial" : null}
                {omitted && showPacked ? " · omitted" : null}
              </span>
              <span
                className="text-right font-mono text-[10px] tabular-nums sm:text-[11px]"
                style={{ color: "var(--muted)" }}
              >
                {s.isBinaryPlaceholder ? "—" : s.charsInitial.toLocaleString()}
              </span>
              {showPacked ? (
                <span
                  className="text-right font-mono text-[10px] tabular-nums sm:text-[11px]"
                  style={{ color: omitted ? "var(--muted)" : partial ? "var(--warn)" : "var(--accent)" }}
                  title={
                    omitted
                      ? "Not included in the last context window (retrieval or bundle cap)"
                      : partial
                        ? "Only part of this source fit in the context window"
                        : "Included in full"
                  }
                >
                  {s.isBinaryPlaceholder ? "—" : (packedChars ?? 0).toLocaleString()}
                </span>
              ) : null}
              {showPacked && showChunks ? (
                <span
                  className="text-right font-mono text-[10px] tabular-nums sm:text-[11px]"
                  style={{ color: (chunksInWindow ?? 0) > 0 ? "var(--accent)" : "var(--muted)" }}
                  title="Retrieved chunks from this source in the last ranked pack"
                >
                  {(chunksInWindow ?? 0) > 0 ? chunksInWindow : "—"}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {showPacked ? (
        <p className="px-3 py-2 text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Available = full extracted text after refresh. In context = characters from this source in the last{" "}
          <strong>Build context window</strong> run
          {showChunks ? "; Chunks = embedding-ranked excerpts when retrieval is active" : ""}. Omitted sources show 0.
        </p>
      ) : buildPendingHint ? (
        buildPendingHint
      ) : null}
      {emptyHint}
    </>
  );
}
