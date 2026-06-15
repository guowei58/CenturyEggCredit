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
  className = "",
}: {
  /** When true, the main response / excel area has saved or loaded content. */
  hasMainContent: boolean;
  main: ReactNode;
  prompt: ReactNode;
  /** Optional strip always visible above main (e.g. Excel upload). */
  toolbar?: ReactNode;
  className?: string;
}) {
  const [open, setOpen] = useState(true);
  const prevHasMainContent = useRef(hasMainContent);
  const { top, height } = useCompanyTabWorkspaceInsets();

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
    if (wasEmpty && nowHasContent) {
      setOpen(false);
    } else if (!wasEmpty && !nowHasContent) {
      setOpen(true);
    }
    prevHasMainContent.current = hasMainContent;
  }, [hasMainContent]);

  return (
    <div className={`tab-prompt-slide-out-root ${className}`.trim()} style={insetStyle}>
      {toolbar ? <div className="tab-prompt-slide-out-toolbar">{toolbar}</div> : null}

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
