"use client";

import { useState, type ReactNode } from "react";

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
  /** When omitted or empty, the sort control is hidden. */
  sortValue?: string;
  onSortChange?: (value: string) => void;
  sortOptions?: CompanyFeedSortOption[];
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
  const [filtersOpen, setFiltersOpen] = useState(false);
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

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {sortOptions?.length ? (
            <label className="flex shrink-0 items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Sort by
              </span>
              <select
                value={sortValue ?? sortOptions[0].value}
                onChange={(e) => onSortChange?.(e.target.value)}
                className="min-w-[9rem] rounded-md border bg-[var(--card)] px-2.5 py-1.5 text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {filterSection ? (
            <button
              type="button"
              onClick={() => setFiltersOpen((open) => !open)}
              className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition-opacity hover:opacity-90"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "var(--card)" }}
              aria-expanded={filtersOpen}
            >
              {filtersOpen ? "▾" : "▸"} {filterSectionTitle}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            disabled={refreshDisabled || refreshBusy}
            className="ml-auto shrink-0 rounded-md border px-3 py-1.5 text-sm font-semibold transition-opacity disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
          >
            {btnLabel}
          </button>
        </div>
        {filterSection && filtersOpen ? (
          <div className="rounded-md border px-3 py-2" style={{ borderColor: "var(--border2)" }}>
            {filterSection}
          </div>
        ) : null}
      </div>

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
