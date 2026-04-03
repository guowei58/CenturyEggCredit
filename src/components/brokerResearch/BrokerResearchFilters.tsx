"use client";

import type { BrokerAccessLevel, BrokerReportType } from "@/lib/brokerResearch/types";

const REPORT_TYPES: BrokerReportType[] = [
  "initiation",
  "upgrade",
  "downgrade",
  "rating_change",
  "target_price_change",
  "earnings_preview",
  "earnings_recap",
  "company_update",
  "sector_note",
  "thematic_note",
  "research_portal",
  "public_insight",
  "research_landing_page",
  "unknown",
];

const ACCESS: BrokerAccessLevel[] = ["public", "login_required", "subscription_likely", "unknown"];

export function BrokerResearchFilters({
  brokerFilter,
  onBrokerFilterChange,
  typeFilter,
  onTypeFilterChange,
  accessFilter,
  onAccessFilterChange,
  sortMode,
  onSortModeChange,
  timelineMode,
  onTimelineModeChange,
  brokerIds,
}: {
  brokerFilter: string | "all";
  onBrokerFilterChange: (v: string | "all") => void;
  typeFilter: BrokerReportType | "all";
  onTypeFilterChange: (v: BrokerReportType | "all") => void;
  accessFilter: BrokerAccessLevel | "all";
  onAccessFilterChange: (v: BrokerAccessLevel | "all") => void;
  sortMode: "relevance" | "recent";
  onSortModeChange: (v: "relevance" | "recent") => void;
  timelineMode: boolean;
  onTimelineModeChange: (v: boolean) => void;
  brokerIds: string[];
}) {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-end">
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Broker
        </div>
        <select
          value={brokerFilter}
          onChange={(e) => onBrokerFilterChange((e.target.value || "all") as typeof brokerFilter)}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="all">All</option>
          {brokerIds.map((id) => (
            <option key={id} value={id}>
              {id.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Report type
        </div>
        <select
          value={typeFilter}
          onChange={(e) => onTypeFilterChange((e.target.value || "all") as typeof typeFilter)}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="all">All types</option>
          {REPORT_TYPES.map((t) => (
            <option key={t} value={t}>
              {t.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
      <div>
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Access
        </div>
        <select
          value={accessFilter}
          onChange={(e) => onAccessFilterChange((e.target.value || "all") as typeof accessFilter)}
          className="rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          <option value="all">All</option>
          {ACCESS.map((a) => (
            <option key={a} value={a}>
              {a.replace(/_/g, " ")}
            </option>
          ))}
        </select>
      </div>
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
      <label className="flex cursor-pointer items-center gap-2 text-sm" style={{ color: "var(--muted2)" }}>
        <input type="checkbox" checked={timelineMode} onChange={(e) => onTimelineModeChange(e.target.checked)} />
        Group by date (timeline)
      </label>
    </div>
  );
}
