"use client";

import { LOGO_MARK_CELL_BG } from "@/components/layout/logoMarkCellStyle";

/**
 * Newspaper-reading century egg (`/images/daily-news-logo.png`). `nav` / `drawerHeader` sit on
 * {@link LOGO_MARK_CELL_BG} like {@link EggHocCommitteeMark}; artwork includes its own mint field.
 */
const LOGO_SRC = "/images/daily-news-logo.png";

const ICON_SURFACE = "linear-gradient(148deg, #5eead4 0%, #2dd4bf 28%, #14b8a6 62%, #0d9488 100%)";
const ICON_BORDER = "#0f766e";

const NAV_BOX = "inline-flex shrink-0 overflow-hidden border-0 p-px sm:p-0.5 size-6 sm:size-7";
/** Same footprint as Egg-Hoc `drawerHeader` preset — panel title row. */
const DRAWER_HEADER_BOX =
  "inline-flex shrink-0 overflow-hidden border-0 p-px sm:p-0.5 size-12 sm:size-[3.35rem]";

const sizeClass: Record<"sm" | "md" | "lg" | "xl", string> = {
  sm: "h-10 w-10 min-h-10 min-w-10 rounded-2xl sm:rounded-[1.35rem]",
  md: "h-12 w-12 min-h-12 min-w-12 rounded-[1.35rem] sm:h-14 sm:w-14 sm:min-h-14 sm:min-w-14 sm:rounded-[1.5rem]",
  lg: "h-16 w-16 min-h-16 min-w-16 rounded-3xl",
  xl: "h-20 w-20 min-h-20 min-w-20 rounded-3xl",
};

type Props = {
  /** `nav`: Egg-Hoc nav icon size. `drawerHeader`: panel title (green tile, not teal). */
  preset?: "nav" | "drawerHeader" | "tile";
  size?: keyof typeof sizeClass;
  /** Decorative (e.g. inside a button that already has aria-label). */
  decorative?: boolean;
  className?: string;
};

function GreenCellMark({
  boxClass,
  className,
  ariaHidden,
}: {
  boxClass: string;
  className: string;
  ariaHidden: boolean;
}) {
  return (
    <div
      className={`${boxClass} ${className}`.trim()}
      style={LOGO_MARK_CELL_BG}
      aria-hidden={ariaHidden ? "true" : undefined}
    >
      <div className="relative h-full w-full min-h-0 min-w-0 overflow-hidden rounded-[0.45rem]">
        {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset */}
        <img
          src={LOGO_SRC}
          alt=""
          width={1024}
          height={1024}
          className="h-full w-full object-cover object-center select-none"
          draggable={false}
        />
      </div>
    </div>
  );
}

export function DailyNewsMark({ preset = "tile", size = "md", decorative = false, className = "" }: Props) {
  if (preset === "nav") {
    return <GreenCellMark boxClass={NAV_BOX} className={className} ariaHidden={true} />;
  }
  if (preset === "drawerHeader") {
    return <GreenCellMark boxClass={DRAWER_HEADER_BOX} className={className} ariaHidden={true} />;
  }

  const dim = sizeClass[size];
  return (
    <div
      className={`flex shrink-0 items-center justify-center overflow-hidden border shadow-md ${dim} ${className}`.trim()}
      style={{
        background: ICON_SURFACE,
        borderColor: ICON_BORDER,
        boxShadow: "0 2px 8px rgba(15, 118, 110, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.25)",
      }}
    >
      <img
        src={LOGO_SRC}
        alt={decorative ? "" : "Daily News"}
        width={1024}
        height={1024}
        className="h-full w-full object-cover object-center select-none"
        draggable={false}
        aria-hidden={decorative}
      />
    </div>
  );
}
