"use client";

export function XSearchFilters({
  includeRetweets,
  onIncludeRetweetsChange,
  language,
  onLanguageChange,
  sortMode,
  onSortModeChange,
}: {
  includeRetweets: boolean;
  onIncludeRetweetsChange: (v: boolean) => void;
  language: string;
  onLanguageChange: (v: string) => void;
  sortMode: "relevance" | "recent" | "engagement";
  onSortModeChange: (v: "relevance" | "recent" | "engagement") => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
        <input type="checkbox" checked={includeRetweets} onChange={(e) => onIncludeRetweetsChange(e.target.checked)} />
        Include retweets
      </label>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Language
        </div>
        <input
          value={language}
          onChange={(e) => onLanguageChange(e.target.value)}
          className="w-28 rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          placeholder="en"
        />
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Sort
        </div>
        <select
          value={sortMode}
          onChange={(e) => onSortModeChange(e.target.value as typeof sortMode)}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="relevance">Relevance</option>
          <option value="recent">Most recent</option>
          <option value="engagement">Highest engagement</option>
        </select>
      </div>
    </div>
  );
}

