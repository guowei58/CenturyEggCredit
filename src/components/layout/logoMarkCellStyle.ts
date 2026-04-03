import type { CSSProperties } from "react";

/** Green gradient tile behind the century egg — same as the main OREO header mark. */
export const LOGO_MARK_CELL_BG: CSSProperties = {
  background: "linear-gradient(155deg, #2ef5cd 0%, var(--accent) 38%, #00b386 100%)",
  borderRadius: "0.5rem",
  boxShadow:
    "inset 0 2px 10px rgba(255,255,255,0.18), inset 0 -8px 14px rgba(0,0,0,0.14), 0 1px 2px rgba(0,0,0,0.18)",
  isolation: "isolate",
};
