"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import {
  formatWorkspaceBadge,
  isCikWorkspaceKey,
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

function reorderList<T>(list: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return list;
  const next = [...list];
  const [removed] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, removed);
  return next;
}

async function fetchWatchlistServer(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/me/watchlist");
    if (!res.ok) return null;
    const data = (await res.json()) as { tickers?: unknown };
    return Array.isArray(data.tickers) ? data.tickers.filter((t): t is string => typeof t === "string") : null;
  } catch {
    return null;
  }
}

async function persistWatchlistServer(list: string[]): Promise<boolean> {
  try {
    const res = await fetch("/api/me/watchlist", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tickers: list }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function normalizeWorkspaceKey(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isCikWorkspaceKey(t)) return t;
  return sanitizeTicker(t);
}

export function LeftSidebar({
  onTickerSelect,
  currentTicker,
}: {
  onTickerSelect: (ticker: string) => void;
  currentTicker: string | null;
}) {
  const { status } = useSession();
  const [search, setSearch] = useState("");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [resolveBusy, setResolveBusy] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const activeWatchlistRowRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollAreaRef = useRef<HTMLDivElement | null>(null);

  const normalizedCurrentTicker = normalizeWorkspaceKey(currentTicker ?? "");

  const persistWatchlist = useCallback(async (list: string[]) => {
    await persistWatchlistServer(list);
  }, []);

  /** Load server watchlist when session becomes available. Do not change the active ticker here—async completion used to race user clicks and reset the wrong company. */
  useEffect(() => {
    if (status === "loading") return;

    if (status !== "authenticated") {
      setWatchlist([]);
      return;
    }

    let cancelled = false;
    void (async () => {
      const list = (await fetchWatchlistServer()) ?? [];
      if (!cancelled) setWatchlist(list);
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (watchlist.length === 0) {
      setNames({});
      return;
    }
    let cancelled = false;
    const next: Record<string, string> = {};
    Promise.all(
      watchlist.map(async (tk) => {
        try {
          const res = await fetch(`/api/company/${encodeURIComponent(tk)}`);
          if (cancelled) return;
          const body = res.ok ? ((await res.json()) as { name?: string }) : null;
          const fetched = typeof body?.name === "string" ? body.name.trim() : "";
          const name = isPrivateWorkspaceKey(tk)
            ? privateWorkspaceDisplayName(tk, fetched || null)
            : fetched;
          if (!res.ok && !isPrivateWorkspaceKey(tk)) return;
          const badge = formatWorkspaceBadge(tk).toUpperCase();
          const shouldStore =
            name &&
            (isPrivateWorkspaceKey(tk)
              ? name.toUpperCase() !== badge
              : name.toUpperCase() !== tk.toUpperCase() && name.toUpperCase() !== badge);
          if (!cancelled && shouldStore) next[tk] = name;
        } catch {
          // ignore
        }
      })
    ).then(() => {
      if (!cancelled) setNames((prev) => ({ ...prev, ...next }));
    });
    return () => {
      cancelled = true;
    };
  }, [watchlist]);

  useLayoutEffect(() => {
    if (!normalizedCurrentTicker || watchlist.length === 0) return;
    const el = activeWatchlistRowRef.current;
    if (!el) return;
    const pane = sidebarScrollAreaRef.current;
    if (!pane || !pane.contains(el)) return;
    requestAnimationFrame(() => {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [normalizedCurrentTicker, watchlist]);

  async function handleGo() {
    const raw = search.trim();
    if (!raw || resolveBusy) return;
    setResolveBusy(true);
    setResolveError(null);
    try {
      const res = await fetch(`/api/company/resolve?q=${encodeURIComponent(raw)}`, { cache: "no-store" });
      const body = (await res.json()) as {
        workspaceKey?: string;
        companyName?: string;
        error?: string;
      };
      if (!res.ok || !body.workspaceKey) {
        throw new Error(body.error ?? "Could not resolve company");
      }
      const sym = body.workspaceKey;
      setWatchlist((prev) => {
        const norm = normalizeWorkspaceKey(sym);
        const alreadyHas = prev.some((t) => normalizeWorkspaceKey(t) === norm);
        if (alreadyHas) return prev;
        const next = [...prev, sym];
        void persistWatchlist(next);
        return next;
      });
      const resolvedName = privateWorkspaceDisplayName(sym, body.companyName?.trim() ?? null);
      if (resolvedName && resolvedName !== "Private company") {
        setNames((prev) => ({ ...prev, [sym]: resolvedName }));
      }
      onTickerSelect(sym);
      setSearch("");
    } catch (e) {
      setResolveError(e instanceof Error ? e.message : "Could not resolve company");
    } finally {
      setResolveBusy(false);
    }
  }

  function removeFromWatchlist(ticker: string) {
    setWatchlist((prev) => {
      const next = prev.filter((t) => t !== ticker);
      void persistWatchlist(next);
      return next;
    });
  }

  function handleDragStart(e: React.DragEvent, index: number) {
    setDraggedIndex(index);
    e.dataTransfer.setData("text/plain", index.toString());
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDropTargetIndex(index);
  }

  function handleDragLeave() {
    setDropTargetIndex(null);
  }

  function handleDrop(e: React.DragEvent, toIndex: number) {
    e.preventDefault();
    setDropTargetIndex(null);
    const fromIndex = draggedIndex;
    if (fromIndex === null) return;
    setDraggedIndex(null);
    if (fromIndex === toIndex) return;
    setWatchlist((prev) => {
      const next = reorderList(prev, fromIndex, toIndex);
      void persistWatchlist(next);
      return next;
    });
  }

  function handleDragEnd() {
    setDraggedIndex(null);
    setDropTargetIndex(null);
  }

  return (
    <aside
      className="flex w-56 flex-shrink-0 flex-col overflow-hidden border-r sm:w-[15.5rem]"
      style={{ background: "var(--sb)", borderColor: "var(--border)" }}
    >
      <div
        className="flex flex-col gap-3 border-b p-4"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Ticker, CIK, or name"
            maxLength={120}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              if (resolveError) setResolveError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleGo();
            }}
            disabled={resolveBusy}
            className="min-w-0 flex-1 rounded-md border bg-[var(--card)] px-3 py-2 font-mono text-xs tracking-wide text-[var(--text)] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <button
            type="button"
            onClick={() => void handleGo()}
            disabled={resolveBusy || !search.trim()}
            className="flex-shrink-0 rounded-md bg-[var(--accent)] px-3 py-2 font-mono text-xs font-semibold text-black hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {resolveBusy ? "…" : "GO"}
          </button>
        </div>
        {resolveError ? (
          <p className="text-[10px] leading-snug" style={{ color: "var(--danger)" }}>
            {resolveError}
          </p>
        ) : null}
      </div>
      <div ref={sidebarScrollAreaRef} className="flex-1 overflow-y-auto">
        <div
          className="px-5 pt-6 pb-3 text-[9px] font-semibold uppercase tracking-widest"
          style={{ color: "var(--muted)" }}
        >
          Watchlist
        </div>
        {watchlist.length === 0 ? (
          <div
            className="px-4 py-4 text-[11px] leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            No companies saved.
            <br />
            Enter a ticker, CIK, or company name and press GO to add.
          </div>
        ) : (
          <div className="space-y-1 px-2.5 pb-3">
            {watchlist.map((tk, index) => {
              const normalizedRow = normalizeWorkspaceKey(tk);
              const isSelected =
                normalizedCurrentTicker !== null &&
                normalizedRow !== null &&
                normalizedCurrentTicker === normalizedRow;
              return (
              <div
                key={tk}
                ref={isSelected ? activeWatchlistRowRef : undefined}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`group flex w-full cursor-grab active:cursor-grabbing items-start gap-2 rounded-lg border-l-[3px] py-2 pl-2.5 pr-1.5 ${
                  isSelected
                    ? "border-l-[var(--accent)] bg-[var(--accent)]/15 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--accent)_35%,transparent)]"
                    : "border-l-transparent hover:bg-white/[0.03]"
                } ${draggedIndex === index ? "opacity-50" : ""} ${
                  dropTargetIndex === index ? "ring-1 ring-[var(--accent)] ring-inset" : ""
                }`}
              >
                <span
                  className="mt-0.5 flex-shrink-0 touch-none font-sans text-[10px] leading-none"
                  style={{ color: "var(--muted)" }}
                  aria-hidden
                >
                  ⋮⋮
                </span>
                <button
                  type="button"
                  onClick={() => onTickerSelect(tk)}
                  className="min-w-0 flex-1 flex-col items-start gap-1 pr-2 text-left"
                  aria-current={isSelected ? "true" : undefined}
                >
                  <span
                    className={`font-mono text-xs ${isSelected ? "font-semibold" : "font-medium"}`}
                    style={{ color: isSelected ? "var(--accent)" : "var(--text)" }}
                  >
                    {formatWorkspaceBadge(tk)}
                  </span>
                  <span
                    className="line-clamp-2 text-[11px] leading-snug"
                    style={{ color: "var(--muted2)" }}
                    title={names[tk] ?? ""}
                  >
                    {names[tk] ||
                      (isPrivateWorkspaceKey(tk) ? privateWorkspaceDisplayName(tk) : "") ||
                      "—"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFromWatchlist(tk);
                  }}
                  className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md font-sans text-base leading-none opacity-70 hover:bg-white/10 hover:opacity-100"
                  style={{ color: "var(--muted2)" }}
                  aria-label={`Remove ${tk}`}
                >
                  ×
                </button>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
