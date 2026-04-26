"use client";

export function NewsFilters({
  sortMode,
  onSortModeChange,
}: {
  sortMode: "relevance" | "recent";
  onSortModeChange: (m: "relevance" | "recent") => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
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
