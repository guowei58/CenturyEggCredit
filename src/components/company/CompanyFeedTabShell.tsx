"use client";

import type { ReactNode } from "react";

export type CompanyFeedSortOption = { value: string; label: string };

type CompanyFeedTabShellProps = {
  /** Short intro shown in a bordered panel at the top. */
  description?: ReactNode;
  /** Optional warning / legal line below the description. */
  footnote?: ReactNode;
  onRefresh: () => void;
  refreshDisabled?: boolean;
  refreshBusy?: boolean;
  /** Shown on the button; defaults to "Refresh" if `hasPayload`, else "Load". */
  refreshLabel?: string;
  /** When true, default button label is "Refresh" instead of "Load". */
  hasPayload?: boolean;
  sortValue: string;
  onSortChange: (value: string) => void;
  sortOptions: CompanyFeedSortOption[];
  error?: ReactNode;
  /** When there is no cached payload yet (not an error). */
  emptyState?: ReactNode;
  showRefreshingBanner?: boolean;
  /** Collapsed by default — ticker overrides, extra filters, etc. */
  filterSection?: ReactNode;
  filterSectionTitle?: string;
  /** Compact summary between controls and the list (counts, API notes). */
  statsSection?: ReactNode;
  children: ReactNode;
};

/**
 * Shared layout for company “research feed” tabs: intro → sort + refresh → optional filters (details) → stats → bordered results.
 */
export function CompanyFeedTabShell({
  description,
  footnote,
  onRefresh,
  refreshDisabled,
  refreshBusy,
  refreshLabel,
  hasPayload,
  sortValue,
  onSortChange,
  sortOptions,
  error,
  emptyState,
  showRefreshingBanner,
  filterSection,
  filterSectionTitle = "Search options & filters",
  statsSection,
  children,
}: CompanyFeedTabShellProps) {
  const btnLabel =
    refreshBusy ? "Loading…" : refreshLabel ?? (hasPayload ? "Refresh" : "Load");

  return (
    <div className="flex flex-col gap-4">
      {description ? (
        <div
          className="rounded-md border px-3 py-2.5 text-xs leading-relaxed"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
        >
          {description}
        </div>
      ) : null}
      {footnote ? (
        <p className="text-[12px] leading-relaxed italic" style={{ color: "var(--warn)" }}>
          {footnote}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Sort by
          </div>
          <select
            value={sortValue}
            onChange={(e) => onSortChange(e.target.value)}
            className="min-w-[11rem] rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshDisabled || refreshBusy}
          className="rounded-md border px-4 py-2 text-sm font-semibold transition-opacity disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
        >
          {btnLabel}
        </button>
      </div>

      {filterSection ? (
        <details className="rounded-md border px-3 py-2" style={{ borderColor: "var(--border2)" }}>
          <summary className="cursor-pointer select-none text-xs font-semibold" style={{ color: "var(--muted2)" }}>
            {filterSectionTitle}
          </summary>
          <div className="mt-3">{filterSection}</div>
        </details>
      ) : null}

      {error ? (
        <div
          className="rounded-md border border-dashed px-3 py-2 text-sm"
          style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
        >
          {error}
        </div>
      ) : null}

      {showRefreshingBanner ? (
        <p className="text-center text-xs" style={{ color: "var(--muted)" }}>
          Refreshing… previous results stay visible until the new run finishes.
        </p>
      ) : null}

      {emptyState}

      {statsSection}

      <section className="border-t pt-4" style={{ borderColor: "var(--border2)" }}>
        {children}
      </section>
    </div>
  );
}
