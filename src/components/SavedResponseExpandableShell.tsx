"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { collectHttpUrlsForSavedResponse } from "@/lib/extract-links-from-saved-content";
import { buildCreditDocSaveLabelMap, lookupCreditDocSaveLabel } from "@/lib/extract-credit-doc-save-label";
import { saveRemoteUrlForTicker } from "@/lib/save-remote-url-client";

/** Add to scroll areas and RichPasteTextarea in saved-response boxes so they fill space in fullscreen. */
export const SAVED_RESPONSE_FS_FILL_CLASS = "saved-response-fs-fill";

/** Outer frame in TabPromptSlideOutShell main — matches Business Model tab. */
export const SAVED_RESPONSE_SHELL_CLASS = "min-w-0 flex-1";

/** Paste / edit textarea — matches Business Model tab (`min-h-[50vh]` / `lg:min-h-[60vh]`). */
export const SAVED_RESPONSE_EDIT_CLASS =
  `min-h-[50vh] w-full flex-1 resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none lg:min-h-[60vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`;

/** Read-only scroll body — matches Business Model tab (`lg:max-h-[65vh]` caps height). */
export const SAVED_RESPONSE_VIEW_CLASS =
  `min-h-[50vh] flex-1 overflow-y-auto rounded border border-transparent px-0 py-2 text-sm leading-relaxed lg:min-h-[60vh] lg:max-h-[65vh] ${SAVED_RESPONSE_FS_FILL_CLASS}`;

/**
 * Wraps a saved-response panel: optional Fullscreen covers the viewport (Escape or Exit fullscreen).
 * Same DOM node — no duplicate editors. Use {@link SAVED_RESPONSE_FS_FILL_CLASS} on inner scroll/textarea.
 */
export function SavedResponseExpandableShell({
  title = "Saved response",
  headerActions,
  className = "",
  fillViewportMinHeight = true,
  hideTitle = false,
  hideHeader = false,
  ticker,
  linkSourceText,
  children,
}: {
  title?: string;
  headerActions?: ReactNode;
  /** Appended to the frame in normal (non-fullscreen) mode only — use {@link SAVED_RESPONSE_SHELL_CLASS}. */
  className?: string;
  /** When false, omit `lg:min-h-[70vh]` (e.g. stacked Credit Agreements boxes). */
  fillViewportMinHeight?: boolean;
  /** Hide the title line; header shows actions only (e.g. Excel workbook viewer). */
  hideTitle?: boolean;
  /** Omit the entire header row (e.g. empty Excel preview). */
  hideHeader?: boolean;
  /** When set, shows "Save all links" to batch-save http(s) URLs to Saved Documents for this ticker. */
  ticker?: string;
  /** Raw saved markdown/HTML/text used to find URLs while editing or when links are not yet in the DOM. */
  linkSourceText?: string | null;
  children: ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saveAllBusy, setSaveAllBusy] = useState(false);
  const [saveAllFeedback, setSaveAllFeedback] = useState<string | null>(null);
  const contentRootRef = useRef<HTMLDivElement>(null);
  const { status: authStatus } = useSession();

  const safeTicker = ticker?.trim() ?? "";
  const showSaveAllLinks = safeTicker.length > 0;

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

  async function handleSaveAllLinks() {
    if (!safeTicker || authStatus !== "authenticated") return;
    const urls = collectHttpUrlsForSavedResponse(contentRootRef.current, linkSourceText ?? "");
    if (urls.length === 0) {
      setSaveAllFeedback("No http(s) links found.");
      window.setTimeout(() => setSaveAllFeedback(null), 4000);
      return;
    }
    setSaveAllBusy(true);
    setSaveAllFeedback(null);
    const saveLabelByUrl = buildCreditDocSaveLabelMap(linkSourceText ?? "");
    let ok = 0;
    let firstErr: string | null = null;
    for (const url of urls) {
      const r = await saveRemoteUrlForTicker(safeTicker, url, "saved-documents", {
        title: lookupCreditDocSaveLabel(saveLabelByUrl, url),
      });
      if (r.ok) ok++;
      else if (!firstErr) firstErr = r.error;
    }
    setSaveAllBusy(false);
    if (!firstErr) {
      setSaveAllFeedback(`Saved ${ok} link${ok === 1 ? "" : "s"}.`);
    } else {
      setSaveAllFeedback(`Saved ${ok} of ${urls.length}. ${firstErr}`);
    }
    window.setTimeout(() => setSaveAllFeedback(null), 6000);
  }

  const tall = fillViewportMinHeight ? "lg:min-h-[70vh]" : "";
  const flushFrame = className.includes("excel-workbook-viewer-frame");
  const framePadding = expanded ? "p-4" : flushFrame ? "p-0" : "p-4";
  const frameClass = expanded
    ? "fixed inset-0 z-[300] m-0 box-border flex max-h-none min-h-0 flex-col overflow-hidden rounded-none border-2 p-4"
    : `box-border flex max-h-none min-w-0 flex-col overflow-visible rounded-lg border-2 ${framePadding} ${tall} ${className}`.trim();

  const saveAllDisabled =
    !showSaveAllLinks || authStatus !== "authenticated" || saveAllBusy;

  return (
    <div
      className={frameClass}
      style={{ borderColor: "var(--accent)", background: "var(--card)" }}
      data-saved-response-expanded={expanded ? "1" : undefined}
    >
      {!hideHeader ? (
      <div
        className={`excel-workbook-viewer-header flex shrink-0 items-center gap-2 ${hideTitle ? "mb-0 justify-end" : "mb-3 justify-between"}`}
      >
        {!hideTitle ? (
          <div className="min-w-0 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {title}
          </div>
        ) : null}
        <div className={`flex shrink-0 flex-wrap items-center gap-2 ${hideTitle ? "justify-end" : "justify-end"}`}>
          {headerActions}
          {showSaveAllLinks ? (
            <button
              type="button"
              onClick={() => void handleSaveAllLinks()}
              disabled={saveAllDisabled}
              title={authStatus !== "authenticated" ? "Sign in to save links" : "Save every http(s) link to Saved Documents"}
              className="rounded border px-2 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
            >
              {saveAllBusy ? "Saving…" : "Save all links"}
            </button>
          ) : null}
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
      ) : null}
      {saveAllFeedback ? (
        <p className="mb-2 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
          {saveAllFeedback}
        </p>
      ) : null}
      <div
        ref={contentRootRef}
        className={expanded ? "flex min-h-0 flex-1 flex-col gap-3 overflow-hidden" : "contents"}
      >
        {children}
      </div>
    </div>
  );
}
