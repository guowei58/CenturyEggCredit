"use client";

const PROVIDER_LABELS: Record<string, string> = {
  marketaux: "Marketaux",
  alpha_vantage: "Alpha Vantage",
  finnhub: "Finnhub",
  newsapi: "NewsAPI",
  major_outlet_rss: "Major outlets (RSS)",
  mock: "Mock",
};

export function NewsFilters({
  enabledFilter,
  onEnabledFilterChange,
  multiSourceOnly,
  onMultiSourceOnlyChange,
  sortMode,
  onSortModeChange,
  registeredIds,
}: {
  enabledFilter: string | "all";
  onEnabledFilterChange: (id: string | "all") => void;
  multiSourceOnly: boolean;
  onMultiSourceOnlyChange: (v: boolean) => void;
  sortMode: "relevance" | "recent";
  onSortModeChange: (m: "relevance" | "recent") => void;
  registeredIds: string[];
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Provider
        </div>
        <select
          value={enabledFilter}
          onChange={(e) => onEnabledFilterChange((e.target.value || "all") as typeof enabledFilter)}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="all">All (merged)</option>
          {registeredIds.map((id) => (
            <option key={id} value={id}>
              {PROVIDER_LABELS[id] ?? id}
            </option>
          ))}
        </select>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
        <input
          type="checkbox"
          checked={multiSourceOnly}
          onChange={(e) => onMultiSourceOnlyChange(e.target.checked)}
        />
        Multi-source only (2+ providers)
      </label>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Sort
        </div>
        <select
          value={sortMode}
          onChange={(e) => onSortModeChange(e.target.value as "relevance" | "recent")}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="relevance">Relevance</option>
          <option value="recent">Most recent</option>
        </select>
      </div>
    </div>
  );
}
