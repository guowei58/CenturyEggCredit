"use client";

import { useCallback, useEffect, useState } from "react";
import type { DailyNewsBatchPayload, DailyNewsTickerBlock } from "@/lib/daily-news/types";

async function readJsonResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(res.ok ? "Empty response from server." : `Request failed (${res.status}).`);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(
      res.ok ? "Invalid JSON from server. Try again or check the server log." : `Request failed (${res.status}).`
    );
  }
}

type BatchRow = {
  id: string;
  batchDateKey: string;
  generatedAt: string;
  isRead: boolean;
  payload: DailyNewsBatchPayload;
};

export function DailyNewsDrawer({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [batches, setBatches] = useState<BatchRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch("/api/daily-news", { cache: "no-store" });
      const data = await readJsonResponse<{ batches?: BatchRow[]; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Failed to load");
      const list = Array.isArray(data.batches) ? data.batches : [];
      setBatches(list);
      if (list.length > 0) {
        setSelectedId((prev) => prev && list.some((b) => b.id === prev) ? prev : list[0].id);
      } else {
        setSelectedId(null);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const selected = batches.find((b) => b.id === selectedId) ?? null;

  useEffect(() => {
    if (!open || !selectedId) return;
    const batch = batches.find((b) => b.id === selectedId);
    if (!batch || batch.isRead) return;
    void (async () => {
      try {
        await fetch("/api/daily-news", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batchId: batch.id }),
        });
        setBatches((prev) => prev.map((b) => (b.id === batch.id ? { ...b, isRead: true } : b)));
        window.dispatchEvent(new Event("daily-news-read"));
      } catch {
        /* ignore */
      }
    })();
  }, [open, selectedId, batches]);

  async function handleRefresh() {
    setRefreshing(true);
    setErr(null);
    try {
      const res = await fetch("/api/daily-news", { method: "POST" });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Refresh failed");
      await load();
      window.dispatchEvent(new Event("daily-news-read"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div
        className="fixed bottom-0 right-0 z-[198] flex h-full w-[min(100vw,720px)] flex-col border-l transition-transform duration-200 ease-out"
        style={{
          background: "var(--panel)",
          borderColor: "var(--border)",
          transform: open ? "translateX(0)" : "translateX(100%)",
        }}
      >
        <div
          className="flex flex-shrink-0 items-center justify-between gap-3 border-b px-4 py-3 sm:px-5"
          style={{ background: "var(--sb)", borderColor: "var(--border)" }}
        >
          <div className="min-w-0">
            <div className="text-sm font-semibold tracking-tight" style={{ color: "var(--text)" }}>
              Daily News
            </div>
            <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
              Watchlist digest · last 24h · SEC + major outlets + trade press
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              disabled={refreshing}
              className="rounded-md border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
              onClick={() => void handleRefresh()}
            >
              {refreshing ? "Refreshing…" : "Refresh now"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-md p-1.5 transition-colors hover:bg-[var(--card)]"
              style={{ color: "var(--muted2)" }}
              aria-label="Close"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm" style={{ color: "var(--muted2)" }}>
              Loading…
            </div>
          ) : err ? (
            <div className="p-6 text-sm" style={{ color: "var(--danger)" }}>
              {err}
            </div>
          ) : batches.length === 0 ? (
            <div className="p-6 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
              No daily news yet. Add tickers to your watchlist, then use <span className="font-semibold">Refresh now</span> (or wait for the
              morning job).
            </div>
          ) : (
            <>
              <div className="flex flex-shrink-0 flex-wrap gap-2 border-b px-3 py-2.5" style={{ borderColor: "var(--border2)" }}>
                {batches.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => setSelectedId(b.id)}
                    className="rounded-md px-2.5 py-1.5 text-xs font-semibold sm:text-sm"
                    style={
                      selectedId === b.id
                        ? { background: "var(--accent)", color: "#fff" }
                        : {
                            background: "var(--card)",
                            color: "var(--muted)",
                            border: `1px solid ${b.isRead ? "transparent" : "rgba(239,68,68,0.5)"}`,
                          }
                    }
                  >
                    {b.batchDateKey}
                    {!b.isRead ? " · new" : ""}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
                {selected && <DailyNewsBody block={selected} />}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

function ItemList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Array<{ headline: string; summary: string; url: string; source: string; whyItMatters: string }>;
  empty: string;
}) {
  if (!items.length) {
    return (
      <div className="mb-6">
        <h4
          className="mb-2 border-b pb-1.5 text-xs font-bold uppercase tracking-wider sm:text-sm"
          style={{ color: "var(--accent)", borderColor: "var(--border2)" }}
        >
          {title}
        </h4>
        <p className="text-xs leading-relaxed sm:text-sm" style={{ color: "var(--muted2)" }}>
          {empty}
        </p>
      </div>
    );
  }
  return (
    <div className="mb-6">
      <h4
        className="mb-3 border-b pb-2 text-xs font-bold uppercase tracking-wider sm:text-sm"
        style={{ color: "var(--accent)", borderColor: "var(--border2)" }}
      >
        {title}
      </h4>
      <ul className="space-y-3">
        {items.map((it, i) => (
          <li
            key={`${it.url}-${i}`}
            className="rounded-lg border px-3 py-3 text-sm leading-snug sm:px-4 sm:py-3.5"
            style={{ borderColor: "var(--border2)", background: "var(--card)" }}
          >
            <div className="text-base font-semibold leading-tight sm:text-[1.05rem]" style={{ color: "var(--text)" }}>
              {it.headline}
            </div>
            <div className="mt-1.5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
              {it.summary}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: "var(--muted2)" }}>
              <span>{it.source}</span>
              <a href={it.url} target="_blank" rel="noopener noreferrer" className="font-medium underline" style={{ color: "var(--accent)" }}>
                Open link
              </a>
            </div>
            <div className="mt-2 border-t pt-2 text-xs italic leading-relaxed" style={{ color: "var(--muted2)", borderColor: "var(--border2)" }}>
              <span className="font-semibold not-italic" style={{ color: "var(--muted)" }}>
                Why it matters:{" "}
              </span>
              {it.whyItMatters}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TickerSection({ tk, data }: { tk: string; data: DailyNewsTickerBlock }) {
  const pubs = data.industryPublications ?? [];
  return (
    <section
      className="mb-8 rounded-xl border p-4 last:mb-0 sm:p-5"
      style={{
        borderColor: "var(--border)",
        background: "var(--card)",
        boxShadow: "0 1px 0 rgba(0,0,0,0.06)",
      }}
    >
      <div className="flex flex-col gap-1 border-b pb-4 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4" style={{ borderColor: "var(--border2)" }}>
        <div className="min-w-0">
          <div className="font-mono text-2xl font-bold tracking-tight sm:text-3xl" style={{ color: "var(--accent)" }}>
            {tk}
          </div>
          <div className="mt-1 text-sm font-medium leading-snug sm:text-base" style={{ color: "var(--text)" }}>
            {data.companyName}
          </div>
        </div>
      </div>
      {pubs.length > 0 ? (
        <div
          className="mb-4 mt-4 rounded-lg border px-3 py-3 text-xs leading-relaxed sm:text-sm"
          style={{ borderColor: "var(--border2)", background: "var(--sb)" }}
        >
          <div className="font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Industry publications scanned
          </div>
          <ul className="mt-2 list-inside list-disc space-y-1.5 pl-0.5" style={{ color: "var(--text)" }}>
            {pubs.map((p) => (
              <li key={p.id}>
                <span className="font-medium">{p.name}</span>
                <span style={{ color: "var(--muted2)" }}> ({p.siteDomain})</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mb-5 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
        {data.whyItMatters}
      </p>
      <ItemList title="Company-specific news" items={data.companyNews} empty="No major company headlines in the automated sweep." />
      <ItemList title="Industry / trade press" items={data.industryNews} empty="No industry headlines in the automated sweep." />
      <ItemList
        title="SEC filings (last window)"
        items={data.secFilings}
        empty="No prioritized filings in the last 24h window."
      />
    </section>
  );
}

function DailyNewsBody({ block }: { block: BatchRow }) {
  const p = block.payload;
  return (
    <div className="space-y-8">
      <div
        className="rounded-xl border px-4 py-4 text-sm leading-relaxed sm:px-5 sm:py-5"
        style={{ borderColor: "var(--border)", background: "var(--sb)" }}
      >
        <div className="text-base font-bold sm:text-lg" style={{ color: "var(--accent)" }}>
          Today&apos;s biggest developments across the watchlist
        </div>
        <pre className="mt-3 whitespace-pre-wrap font-sans text-sm leading-relaxed sm:text-base" style={{ color: "var(--text)" }}>
          {p.topLevelSummary}
        </pre>
        <div className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Generated {new Date(p.generatedAt).toLocaleString()} · Sources: {p.sourcesUsed.slice(0, 6).join(", ")}
          {p.sourcesUsed.length > 6 ? "…" : ""}
        </div>
        {p.fetchErrors.length > 0 ? (
          <div className="mt-2 text-xs" style={{ color: "var(--warn)" }}>
            Partial errors: {p.fetchErrors.slice(0, 3).map((e) => `${e.source}: ${e.message}`).join(" · ")}
          </div>
        ) : null}
      </div>
      <div className="space-y-8">
        {p.tickers.map((tk) => {
          const data = p.summaryByTicker[tk];
          if (!data) return null;
          return <TickerSection key={tk} tk={tk} data={data} />;
        })}
      </div>
    </div>
  );
}
