"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback, useRef } from "react";

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

export function LeftSidebar({
  onTickerSelect,
  currentTicker,
}: {
  onTickerSelect: (ticker: string) => void;
  currentTicker: string | null;
}) {
  const { status } = useSession();
  const [search, setSearch] = useState(currentTicker ?? "");
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const hydratedRef = useRef(false);

  const persistWatchlist = useCallback(async (list: string[]) => {
    await persistWatchlistServer(list);
  }, []);

  useEffect(() => {
    if (status === "loading") return;
    if (hydratedRef.current) return;

    void (async () => {
      if (status !== "authenticated") {
        setWatchlist([]);
        hydratedRef.current = true;
        return;
      }
      const list = (await fetchWatchlistServer()) ?? [];
      setWatchlist(list);
      if (list.length > 0) onTickerSelect(list[0]);
      hydratedRef.current = true;
    })();
  }, [status, onTickerSelect]);

  useEffect(() => {
    setSearch(currentTicker ?? "");
  }, [currentTicker]);

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
          if (!res.ok || cancelled) return;
          const body = (await res.json()) as { name?: string };
          const name = typeof body.name === "string" ? body.name.trim() : "";
          if (!cancelled && name && name.toUpperCase() !== tk) next[tk] = name;
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

  function handleGo() {
    const ticker = search.trim().toUpperCase();
    if (!ticker) return;
    setWatchlist((prev) => {
      if (prev.includes(ticker)) return prev;
      const next = [...prev, ticker];
      void persistWatchlist(next);
      return next;
    });
    onTickerSelect(ticker);
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
            placeholder="Ticker"
            maxLength={10}
            value={search}
            onChange={(e) => setSearch(e.target.value.toUpperCase())}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleGo();
            }}
            className="min-w-0 flex-1 rounded-md border bg-[var(--card)] px-3 py-2 font-mono text-xs uppercase tracking-wide text-[var(--text)] placeholder:font-sans placeholder:normal-case placeholder:tracking-normal placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
            style={{ borderColor: "var(--border)" }}
          />
          <button
            type="button"
            onClick={handleGo}
            className="flex-shrink-0 rounded-md bg-[var(--accent)] px-3 py-2 font-mono text-xs font-semibold text-black hover:opacity-90"
          >
            GO
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
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
            Enter a ticker and press GO to add.
          </div>
        ) : (
          <div className="space-y-1 px-2.5 pb-3">
            {watchlist.map((tk, index) => (
              <div
                key={tk}
                draggable
                onDragStart={(e) => handleDragStart(e, index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDrop(e, index)}
                onDragEnd={handleDragEnd}
                className={`group flex w-full cursor-grab active:cursor-grabbing items-start gap-2 rounded-lg border-l-2 py-2 pl-2.5 pr-1.5 ${
                  currentTicker === tk
                    ? "border-l-[var(--accent)] bg-[var(--accent)]/10"
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
                >
                  <span className="font-mono text-xs font-medium" style={{ color: "var(--text)" }}>
                    {tk}
                  </span>
                  <span
                    className="line-clamp-2 text-[11px] leading-snug"
                    style={{ color: "var(--muted2)" }}
                    title={names[tk] ?? ""}
                  >
                    {names[tk] || "—"}
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
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}
