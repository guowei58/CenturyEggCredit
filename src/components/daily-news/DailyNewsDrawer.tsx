"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DailyNewsBatchPayload, DailyNewsTickerBlock } from "@/lib/daily-news/types";
import { DailyNewsTickerSourcesDropdown } from "@/components/daily-news/DailyNewsTickerSourcesDropdown";
import { DailyNewsMark } from "@/components/daily-news/DailyNewsMark";
import {
  buildAggregateNewsRows,
  formatAggregateNewsCategory,
  formatAggregateNewsDate,
} from "@/lib/daily-news/aggregate-news";
import {
  usesTickerStyleNewsBadge,
  watchlistNewsDisplayLabel,
} from "@/lib/daily-news/display-label";

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
  /** Flashing red dot on Refresh until a successful pull (each drawer open). */
  const [showRefreshHintDot, setShowRefreshHintDot] = useState(false);

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
    setShowRefreshHintDot(true);
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
      setShowRefreshHintDot(false);
      window.dispatchEvent(new Event("daily-news-read"));
      window.dispatchEvent(new Event("daily-news-user-refreshed"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <>
      <div
        className="fixed bottom-0 right-0 z-[198] flex h-full w-[min(calc(100vw-2rem),1080px)] flex-col border-l transition-transform duration-200 ease-out"
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
          <div className="flex min-w-0 items-center gap-3">
            <DailyNewsMark preset="drawerHeader" />
            <div className="min-w-0">
              <div className="text-sm font-semibold tracking-tight" style={{ color: "var(--text)" }}>
                Daily News
              </div>
              <div className="mt-0.5 text-[10px]" style={{ color: "var(--muted)" }}>
                Watchlist digest · last 24h · SEC, name-led company news, trade headlines + ticker scan
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="relative inline-flex">
              <button
                type="button"
                disabled={refreshing}
                className="rounded-md border px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
                style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                onClick={() => void handleRefresh()}
                title={showRefreshHintDot && !refreshing ? "Pull the latest watchlist digest" : undefined}
                aria-describedby={showRefreshHintDot && !refreshing ? "daily-news-refresh-hint" : undefined}
              >
                {refreshing ? "Refreshing…" : "Refresh now"}
              </button>
              {showRefreshHintDot && !refreshing ? (
                <>
                  <span id="daily-news-refresh-hint" className="sr-only">
                    Tap Refresh now to update your digest.
                  </span>
                  <span
                    className="daily-news-refresh-dot-flash pointer-events-none absolute -right-1 -top-1 flex min-h-[1.125rem] min-w-[1.125rem] shrink-0 items-center justify-center rounded-full bg-red-600 ring-2 ring-[var(--sb)]"
                    aria-hidden
                  />
                </>
              ) : null}
            </div>
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
            <div className="flex flex-col items-center gap-4 p-8 text-sm" style={{ color: "var(--muted2)" }}>
              <DailyNewsMark preset="drawerHeader" />
              <span>Loading…</span>
            </div>
          ) : err ? (
            <div className="p-6 text-sm" style={{ color: "var(--danger)" }}>
              {err}
            </div>
          ) : batches.length === 0 ? (
            <div className="flex flex-col items-center gap-4 p-6 text-center text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
              <DailyNewsMark preset="drawerHeader" />
              <p>
                No daily news yet. Add tickers to your watchlist, then use <span className="font-semibold">Refresh now</span> (or wait for the
                morning job).
              </p>
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
                {selected && (
                  <DailyNewsBody
                    block={selected}
                    onSourcesChanged={() => setShowRefreshHintDot(true)}
                  />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/** Strip intro line when it duplicates the card heading (payload includes it + we render title above). */
function topLevelSummaryBodyLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const first = lines[0]?.trim() ?? "";
  if (/^today'?s biggest developments across the watchlist:?$/i.test(first)) {
    return lines.slice(1).filter((l) => l.trim().length > 0);
  }
  return lines.filter((l) => l.trim().length > 0);
}

/** Legacy payloads: "• TICKER: TICKER: …" → "• TICKER: …" */
function dedupeTickerInBullet(line: string): string {
  return line.replace(/^(\s*•\s+)([A-Z0-9._-]+):\s*\2:\s*/i, "$1$2: ");
}

function resolveBulletWorkspaceKey(
  labelPart: string,
  summaryByTicker: Record<string, DailyNewsTickerBlock>
): string | null {
  const raw = labelPart.trim();
  if (!raw) return null;
  if (summaryByTicker[raw]) return raw;
  const upper = raw.toUpperCase();
  if (summaryByTicker[upper]) return upper;

  for (const [tk, block] of Object.entries(summaryByTicker)) {
    if (block.companyName.trim() === raw) return tk;
    if (watchlistNewsDisplayLabel(tk, block.companyName) === raw) return tk;
  }
  return null;
}

function TopLevelSummaryBulletLine({
  line,
  summaryByTicker,
  onSourcesChanged,
}: {
  line: string;
  summaryByTicker: Record<string, DailyNewsTickerBlock>;
  onSourcesChanged?: () => void;
}) {
  const normalized = dedupeTickerInBullet(line);
  const m = normalized.match(/^(\s*•\s+)([^:]+):\s*(.*)$/);
  if (m) {
    const [, prefix, labelPart, rest] = m;
    const workspaceKey = resolveBulletWorkspaceKey(labelPart.trim(), summaryByTicker);
    const block = workspaceKey ? summaryByTicker[workspaceKey] : undefined;
    const display = workspaceKey
      ? watchlistNewsDisplayLabel(workspaceKey, block?.companyName)
      : labelPart.trim();
    const tickerChip = workspaceKey ? usesTickerStyleNewsBadge(workspaceKey) : /^[A-Z][A-Z0-9._-]*$/.test(labelPart.trim());
    const anchorId = workspaceKey ? `daily-news-aggregate-${workspaceKey}` : null;
    return (
      <p className="m-0 leading-relaxed" style={{ color: "var(--text)" }}>
        {prefix}
        {anchorId ? (
          <button
            type="button"
            className={`mr-1.5 inline-block align-baseline rounded-md px-2 py-0.5 text-[0.9em] font-bold leading-snug hover:opacity-90 ${
              tickerChip ? "font-mono tabular-nums tracking-tight" : ""
            }`}
            style={{
              background: "rgba(0, 212, 170, 0.14)",
              color: "var(--accent)",
              border: "1px solid rgba(0, 212, 170, 0.4)",
            }}
            onClick={() => {
              const el = document.getElementById(anchorId);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            title={`Jump to ${display} in news list`}
            aria-label={`Jump to ${display} in news list`}
          >
            {display}
          </button>
        ) : (
          <span className="mr-1.5 font-semibold" style={{ color: "var(--accent)" }}>
            {display}
          </span>
        )}
        {workspaceKey ? (
          <DailyNewsTickerSourcesDropdown
            ticker={workspaceKey}
            initialPublications={block?.industryPublications}
            onChanged={onSourcesChanged}
          />
        ) : null}
        <span>: {rest}</span>
      </p>
    );
  }
  return (
    <p className="m-0 whitespace-pre-wrap leading-relaxed" style={{ color: "var(--text)" }}>
      {normalized}
    </p>
  );
}

function DailyNewsBody({
  block,
  onSourcesChanged,
}: {
  block: BatchRow;
  onSourcesChanged?: () => void;
}) {
  const p = block.payload;
  const summaryLines = topLevelSummaryBodyLines(p.topLevelSummary);
  const aggregateRows = useMemo(() => buildAggregateNewsRows(p), [p]);

  return (
    <div className="space-y-6">
      <div
        className="rounded-xl border px-4 py-4 text-sm leading-relaxed sm:px-5 sm:py-5"
        style={{ borderColor: "var(--border)", background: "var(--sb)" }}
      >
        <div className="text-base font-bold sm:text-lg" style={{ color: "var(--accent)" }}>
          Today&apos;s biggest developments across the watchlist
        </div>
        <div className="mt-3 space-y-2 font-sans text-sm leading-relaxed sm:text-base">
          {summaryLines.map((line, i) => (
            <TopLevelSummaryBulletLine
              key={i}
              line={line}
              summaryByTicker={p.summaryByTicker}
              onSourcesChanged={onSourcesChanged}
            />
          ))}
        </div>
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
      <AggregateNewsPanel rows={aggregateRows} />
    </div>
  );
}

function AggregateNewsPanel({ rows }: { rows: ReturnType<typeof buildAggregateNewsRows> }) {
  const firstRowAnchorByKey = useMemo(() => {
    const seen = new Set<string>();
    const anchors = new Map<string, string>();
    for (const row of rows) {
      if (seen.has(row.workspaceKey)) continue;
      seen.add(row.workspaceKey);
      anchors.set(row.workspaceKey, `daily-news-aggregate-${row.workspaceKey}`);
    }
    return anchors;
  }, [rows]);

  if (rows.length === 0) {
    return (
      <div
        className="rounded-xl border px-4 py-6 text-sm leading-relaxed sm:px-5"
        style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--muted2)" }}
      >
        No news items in this digest window.
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden rounded-xl border text-xs sm:text-sm"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div
        className="grid grid-cols-[minmax(5rem,6.5rem)_4rem_minmax(4.5rem,5.5rem)_minmax(4rem,5.5rem)_1fr] gap-x-2 border-b px-3 py-2 font-semibold uppercase tracking-wide sm:grid-cols-[minmax(6rem,7.5rem)_4.5rem_minmax(5rem,6rem)_minmax(4.5rem,6rem)_1fr] sm:px-4 sm:text-[10px]"
        style={{ borderColor: "var(--border2)", color: "var(--muted)", background: "var(--sb)" }}
      >
        <span>Company</span>
        <span>Date</span>
        <span>Type</span>
        <span>Source</span>
        <span>Headline</span>
      </div>
      <ul className="divide-y" style={{ borderColor: "var(--border2)" }}>
        {rows.map((row, i) => {
          const anchorId =
            rows.findIndex((r) => r.workspaceKey === row.workspaceKey) === i
              ? firstRowAnchorByKey.get(row.workspaceKey)
              : undefined;
          return (
          <li
            key={`${row.url}-${row.workspaceKey}-${i}`}
            id={anchorId}
            className="min-w-0 scroll-mt-4"
          >
            <a
              href={row.url}
              target="_blank"
              rel="noopener noreferrer"
              className="grid grid-cols-[minmax(5rem,6.5rem)_4rem_minmax(4.5rem,5.5rem)_minmax(4rem,5.5rem)_1fr] items-center gap-x-2 px-3 py-2 leading-snug transition-colors hover:bg-[var(--sb)] sm:grid-cols-[minmax(6rem,7.5rem)_4.5rem_minmax(5rem,6rem)_minmax(4.5rem,6rem)_1fr] sm:px-4"
              title={`${formatAggregateNewsCategory(row.category)} — ${row.headline}`}
            >
              <span
                className={`min-w-0 truncate font-semibold ${
                  usesTickerStyleNewsBadge(row.workspaceKey) ? "font-mono tabular-nums" : ""
                }`}
                style={{ color: "var(--accent)" }}
              >
                {row.displayLabel}
              </span>
              <span className="shrink-0 tabular-nums" style={{ color: "var(--muted2)" }}>
                {formatAggregateNewsDate(row.publishedAt)}
              </span>
              <span className="min-w-0 truncate text-[10px] font-medium sm:text-xs" style={{ color: "var(--muted2)" }}>
                {formatAggregateNewsCategory(row.category)}
              </span>
              <span className="min-w-0 truncate" style={{ color: "var(--muted)" }}>
                {row.source}
              </span>
              <span className="min-w-0 truncate font-medium" style={{ color: "var(--text)" }}>
                {row.headline}
              </span>
            </a>
          </li>
          );
        })}
      </ul>
    </div>
  );
}
