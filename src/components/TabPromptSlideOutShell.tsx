"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

function useCompanyTabWorkspaceInsets() {
  const [insets, setInsets] = useState({ top: 0, height: 0 });

  useLayoutEffect(() => {
    const workspace = document.querySelector("[data-company-tab-workspace]");
    if (!(workspace instanceof HTMLElement)) return;

    const update = () => {
      const rect = workspace.getBoundingClientRect();
      setInsets({ top: Math.max(0, rect.top), height: Math.max(0, rect.height) });
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(workspace);
    window.addEventListener("resize", update);
    document.addEventListener("scroll", update, true);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      document.removeEventListener("scroll", update, true);
    };
  }, []);

  return insets;
}

export function TabPromptSlideOutShell({
  hasMainContent,
  main,
  prompt,
  toolbar,
  toolbarAlign = "end",
  collapsibleToolbar = false,
  collapseToolbarWhen = false,
  collapsibleToolbarLabel = "Setup",
  hasPromptContent = false,
  promptPanelOpen,
  onPromptPanelOpenChange,
  className = "",
}: {
  /** When true, the main response / excel area has saved or loaded content. */
  hasMainContent: boolean;
  main: ReactNode;
  prompt: ReactNode;
  /** Optional strip always visible above main (e.g. Excel upload). */
  toolbar?: ReactNode;
  /** `end` = right-aligned strip (Excel upload); `start` = full-width left-aligned (work product sources). */
  toolbarAlign?: "start" | "end";
  /** When true, toolbar can slide up behind a compact restore bar (AI Memo setup strip). */
  collapsibleToolbar?: boolean;
  /** When true, auto-collapse the toolbar (e.g. after saved memo is on screen). */
  collapseToolbarWhen?: boolean;
  collapsibleToolbarLabel?: string;
  /** When true, keep / reopen the right-hand prompt drawer (e.g. restored context window). */
  hasPromptContent?: boolean;
  /** Controlled prompt drawer open state (e.g. “Run through AI” step). */
  promptPanelOpen?: boolean;
  onPromptPanelOpenChange?: (open: boolean) => void;
  className?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(() => hasPromptContent || !hasMainContent);
  const [toolbarOpen, setToolbarOpen] = useState(() => !(collapsibleToolbar && collapseToolbarWhen));
  const prevHasMainContent = useRef(hasMainContent);
  const prevCollapseToolbarWhen = useRef(collapseToolbarWhen);
  const prevHasPromptContent = useRef(hasPromptContent);
  const { top, height } = useCompanyTabWorkspaceInsets();

  const promptPanelControlled = onPromptPanelOpenChange != null;
  const open = promptPanelControlled ? (promptPanelOpen ?? false) : internalOpen;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (promptPanelControlled) onPromptPanelOpenChange!(resolved);
    else setInternalOpen(resolved);
  };

  const insetStyle: CSSProperties | undefined =
    height > 0
      ? ({
          "--tab-prompt-inset-top": `${top}px`,
          "--tab-prompt-inset-height": `${height}px`,
        } as CSSProperties)
      : undefined;

  useEffect(() => {
    const wasEmpty = !prevHasMainContent.current;
    const nowHasContent = hasMainContent;
    if (wasEmpty && nowHasContent && !hasPromptContent) {
      setOpen(false);
    } else if (!wasEmpty && !nowHasContent) {
      setOpen(true);
    }
    prevHasMainContent.current = hasMainContent;
  }, [hasMainContent, hasPromptContent]);

  useLayoutEffect(() => {
    if (!collapsibleToolbar) return;
    const prev = prevCollapseToolbarWhen.current;
    const now = collapseToolbarWhen;
    if (!prev && now) {
      setToolbarOpen(false);
    } else if (prev && !now) {
      setToolbarOpen(true);
    }
    prevCollapseToolbarWhen.current = now;
  }, [collapseToolbarWhen, collapsibleToolbar]);

  useLayoutEffect(() => {
    const prev = prevHasPromptContent.current;
    const now = hasPromptContent;
    if (!prev && now) {
      setOpen(true);
    }
    prevHasPromptContent.current = now;
  }, [hasPromptContent]);

  const toolbarNode = toolbar ? (
    <div
      className={`tab-prompt-slide-out-toolbar${toolbarAlign === "start" ? " tab-prompt-slide-out-toolbar--start" : ""}`}
    >
      {toolbar}
    </div>
  ) : null;

  return (
    <div className={`tab-prompt-slide-out-root ${className}`.trim()} style={insetStyle}>
      {toolbarNode && collapsibleToolbar ? (
        <div className="tab-slide-up-root">
          {collapseToolbarWhen ? (
            <div className="tab-slide-up-restore">
              <span className="tab-slide-up-restore-label">{collapsibleToolbarLabel}</span>
              <span className="tab-slide-up-restore-actions">
                <button
                  type="button"
                  className="tab-slide-up-restore-btn"
                  disabled={toolbarOpen}
                  onClick={() => setToolbarOpen(true)}
                >
                  Show
                </button>
                <button
                  type="button"
                  className="tab-slide-up-restore-btn"
                  disabled={!toolbarOpen}
                  onClick={() => setToolbarOpen(false)}
                >
                  Hide
                </button>
              </span>
            </div>
          ) : null}
          <div className={`tab-slide-up-panel${!toolbarOpen ? " tab-slide-up-panel--collapsed" : ""}`}>
            <div className="tab-slide-up-panel-inner">{toolbarNode}</div>
          </div>
        </div>
      ) : (
        toolbarNode
      )}

      <div className="tab-prompt-slide-out-main">{main}</div>

      {open ? (
        <button
          type="button"
          className="tab-prompt-slide-out-backdrop"
          aria-label="Close prompt panel"
          onClick={() => setOpen(false)}
        />
      ) : null}

      <aside
        className={`tab-prompt-slide-out-panel${open ? " tab-prompt-slide-out-panel--open" : ""}`}
        aria-hidden={!open}
      >
        <div className="tab-prompt-slide-out-panel-inner">{prompt}</div>
      </aside>

      <button
        type="button"
        className={`tab-prompt-slide-out-tab${open ? " tab-prompt-slide-out-tab--open" : ""}`}
        aria-expanded={open}
        aria-controls="tab-prompt-slide-out-panel"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tab-prompt-slide-out-tab-label">{open ? "Hide" : "Prompt"}</span>
      </button>
    </div>
  );
}
