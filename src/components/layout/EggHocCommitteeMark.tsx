"use client";

import { LOGO_MARK_CELL_BG } from "./logoMarkCellStyle";

const CENTURY_EGG_MARK = "/century-egg-mark.png";

/** Fill more of the square; overlap pulls the pair in so both stay visible. */
const IMG =
  "h-[92%] w-auto max-w-[74%] shrink-0 object-contain object-center mix-blend-multiply contrast-[1.08] sm:h-[94%] sm:max-w-[72%]";

const EGG_HOC_NAV_BOX_DIMS = "size-6 sm:size-7" as const;

/** Same outer footprint as `EggHocCommitteeMark` `preset="nav"` — wrap the AI Chat robot. */
export const AI_CHAT_NAV_ICON_FRAME_CLASSNAME =
  `inline-flex shrink-0 items-center justify-center p-px sm:p-0.5 ${EGG_HOC_NAV_BOX_DIMS}` as const;

const PRESETS = {
  nav: { box: EGG_HOC_NAV_BOX_DIMS, space: "-space-x-1.5 sm:-space-x-2" },
  fab: { box: "size-10", space: "-space-x-2.5" },
  drawerHeader: { box: "size-12 sm:size-[3.35rem]", space: "-space-x-2.5 sm:-space-x-3" },
  chatBox: { box: "size-[4.5rem] sm:size-[5.25rem]", space: "-space-x-3 sm:-space-x-3.5" },
} as const;

export type EggHocCommitteeMarkPreset = keyof typeof PRESETS;

export function EggHocCommitteeMark({
  preset,
  className,
}: {
  preset: EggHocCommitteeMarkPreset;
  className?: string;
}) {
  const { box, space } = PRESETS[preset];

  return (
    <div
      className={`inline-flex shrink-0 overflow-hidden border-0 p-px sm:p-0.5 ${box} ${className ?? ""}`}
      style={LOGO_MARK_CELL_BG}
      aria-hidden="true"
    >
      <div
        className={`flex h-full w-full items-center justify-center px-px ${space}`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset */}
        <img src={CENTURY_EGG_MARK} alt="" className={IMG} draggable={false} />
        {/* eslint-disable-next-line @next/next/no-img-element -- static /public asset */}
        <img src={CENTURY_EGG_MARK} alt="" className={IMG} draggable={false} />
      </div>
    </div>
  );
}
