"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";

/** Add to scroll areas and RichPasteTextarea in saved-response boxes so they fill space in fullscreen. */
export const SAVED_RESPONSE_FS_FILL_CLASS = "saved-response-fs-fill";

/**
 * Wraps a saved-response panel: optional Fullscreen covers the viewport (Escape or Exit fullscreen).
 * Same DOM node — no duplicate editors. Use {@link SAVED_RESPONSE_FS_FILL_CLASS} on inner scroll/textarea.
 */
export function SavedResponseExpandableShell({
  title = "Saved response",
  headerActions,
  className = "",
  fillViewportMinHeight = true,
  children,
}: {
  title?: string;
  headerActions?: ReactNode;
  /** Appended to the frame in normal (non-fullscreen) mode only — e.g. `min-w-0 flex-1 gap-4 overflow-y-auto` */
  className?: string;
  /** When false, omit `lg:min-h-[70vh]` (e.g. stacked Credit Agreements boxes). */
  fillViewportMinHeight?: boolean;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  useEffect(() => {
    if (!expanded) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [expanded]);

  const tall = fillViewportMinHeight ? "lg:min-h-[70vh]" : "";
  const frameClass = expanded
    ? "fixed inset-0 z-[300] m-0 box-border flex max-h-none min-h-0 flex-col overflow-hidden rounded-none border-2 p-4"
    : `box-border flex max-h-none flex-col overflow-visible rounded-lg border-2 p-4 ${tall} ${className}`.trim();

  return (
    <div
      className={frameClass}
      style={{ borderColor: "var(--accent)", background: "var(--card)" }}
      data-saved-response-expanded={expanded ? "1" : undefined}
    >
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </div>
        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {headerActions}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border px-2 py-1 text-[11px] font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
          >
            {expanded ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">{children}</div>
      ) : (
        children
      )}
    </div>
  );
}
