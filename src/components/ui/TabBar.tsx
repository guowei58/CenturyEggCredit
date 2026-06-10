"use client";

import type { ReactNode } from "react";

export type TabBarVariant = "company" | "pm";

export function TabBar<Id extends string>({
  tabs,
  activeId,
  onSelect,
  variant = "company",
  className = "",
  renderTabTrailing,
}: {
  tabs: readonly { id: Id; label: string }[];
  activeId: string;
  onSelect: (id: Id) => void;
  variant?: TabBarVariant;
  /** Horizontal inset; defaults to px-6 sm:px-8. Pass e.g. px-5 sm:px-8 to match sibling page gutters. */
  className?: string;
  /** Inline controls rendered inside each tab chip (e.g. save / fullscreen). */
  renderTabTrailing?: (tabId: Id, isActive: boolean) => ReactNode;
}) {
  const baseClass = variant === "pm" ? "pm-tab-item" : "tab-bar-item";
  const wrap = variant === "company";
  const padClass = className.trim() || "px-6 sm:px-8";
  return (
    <div
      className={`flex flex-shrink-0 ${padClass} ${wrap ? "tab-bar-company flex-wrap" : "gap-0 overflow-x-auto"}`}
      style={{ background: "var(--panel)", borderColor: "var(--border)", borderBottomWidth: wrap ? 0 : 1 }}
    >
      {tabs.map((tab) => {
        const isActive = activeId === tab.id;
        const trailing = renderTabTrailing?.(tab.id, isActive);
        if (!trailing) {
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelect(tab.id)}
              className={`${baseClass} ${isActive ? "active" : ""}`}
            >
              {tab.label}
            </button>
          );
        }
        return (
          <div
            key={tab.id}
            className={`tab-bar-cell ${isActive ? "active" : ""}`}
            data-tab-active={isActive ? "1" : undefined}
          >
            <button type="button" onClick={() => onSelect(tab.id)} className={`${baseClass} tab-bar-cell-label ${isActive ? "active" : ""}`}>
              {tab.label}
            </button>
            <div className="tab-bar-cell-actions" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
              {trailing}
            </div>
          </div>
        );
      })}
    </div>
  );
}
