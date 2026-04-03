"use client";

export type TabBarVariant = "company" | "pm";

export function TabBar<Id extends string>({
  tabs,
  activeId,
  onSelect,
  variant = "company",
}: {
  tabs: readonly { id: Id; label: string }[];
  activeId: string;
  onSelect: (id: Id) => void;
  variant?: TabBarVariant;
}) {
  const baseClass = variant === "pm" ? "pm-tab-item" : "tab-bar-item";
  const wrap = variant === "company";
  return (
    <div
      className={`flex flex-shrink-0 px-6 sm:px-8 ${wrap ? "tab-bar-company flex-wrap" : "gap-0 overflow-x-auto"}`}
      style={{ background: "var(--panel)", borderColor: "var(--border)", borderBottomWidth: wrap ? 0 : 1 }}
    >
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          onClick={() => onSelect(tab.id)}
          className={`${baseClass} ${activeId === tab.id ? "active" : ""}`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
