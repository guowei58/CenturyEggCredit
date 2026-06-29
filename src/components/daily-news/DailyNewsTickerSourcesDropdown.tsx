"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_CUSTOM_INDUSTRY_PUBLICATIONS } from "@/lib/daily-news/custom-publications-constants";
import type { DailyNewsIndustryPublication } from "@/lib/daily-news/types";

type SourceRow = {
  id: string;
  name: string;
  siteDomain: string;
  url: string;
};

type IndustrySourcesResponse = {
  mode: "custom" | "auto" | "none";
  customPublications: Array<{ id: string; url: string; siteDomain: string; name: string }>;
  autoPublications: Array<{ id: string; name: string; siteDomain: string }>;
  effectivePublications: Array<{ id: string; name: string; siteDomain: string }>;
  error?: string;
};

function rowsFromPayload(initial?: DailyNewsIndustryPublication[]): SourceRow[] {
  if (!initial?.length) return [];
  return initial.map((p) => ({
    id: p.id,
    name: p.name,
    siteDomain: p.siteDomain,
    url: p.url ?? `https://${p.siteDomain}`,
  }));
}

function rowsFromApi(data: IndustrySourcesResponse): SourceRow[] {
  if (data.mode === "none") return [];
  if (data.mode === "custom" && data.customPublications.length > 0) {
    return data.customPublications.map((p) => ({
      id: p.id,
      name: p.name,
      siteDomain: p.siteDomain,
      url: p.url,
    }));
  }
  return (data.autoPublications.length ? data.autoPublications : data.effectivePublications).map((p) => ({
    id: p.id,
    name: p.name,
    siteDomain: p.siteDomain,
    url: `https://${p.siteDomain}`,
  }));
}

export function DailyNewsTickerSourcesDropdown({
  ticker,
  initialPublications,
  onChanged,
}: {
  ticker: string;
  initialPublications?: DailyNewsIndustryPublication[];
  onChanged?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<"custom" | "auto" | "none">("auto");
  const [sources, setSources] = useState<SourceRow[]>(() => rowsFromPayload(initialPublications));
  const [adding, setAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-news/industry-publications/${encodeURIComponent(ticker)}`, {
        cache: "no-store",
      });
      const data = (await res.json()) as IndustrySourcesResponse;
      if (!res.ok) throw new Error(data.error ?? "Failed to load sources");
      setMode(data.mode);
      setSources(rowsFromApi(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setAdding(false);
        setNewUrl("");
        setError(null);
      }
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  async function persist(nextSources: SourceRow[]) {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      if (nextSources.length === 0) {
        const res = await fetch(`/api/daily-news/industry-publications/${encodeURIComponent(ticker)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ publications: [] }),
        });
        const data = (await res.json()) as IndustrySourcesResponse & { error?: string };
        if (!res.ok) throw new Error(data.error ?? "Save failed");
        setMode(data.mode);
        setSources([]);
        setHint("Industry sources cleared. Refresh digest to apply.");
        onChanged?.();
        return;
      }

      const res = await fetch(`/api/daily-news/industry-publications/${encodeURIComponent(ticker)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publications: nextSources.map((s) => ({ url: s.url, name: s.name })),
        }),
      });
      const data = (await res.json()) as IndustrySourcesResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      setMode(data.mode);
      setSources(rowsFromApi(data));
      setHint("Saved. Refresh digest to apply.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(index: number) {
    const next = sources.filter((_, i) => i !== index);
    setSources(next);
    await persist(next);
  }

  async function handleAddSource() {
    const url = newUrl.trim();
    if (!url) return;
    if (sources.length >= MAX_CUSTOM_INDUSTRY_PUBLICATIONS) {
      setError(`At most ${MAX_CUSTOM_INDUSTRY_PUBLICATIONS} sources allowed.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/daily-news/industry-publications/${encodeURIComponent(ticker)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          publications: [...sources.map((s) => ({ url: s.url, name: s.name })), { url, name: null }],
        }),
      });
      const data = (await res.json()) as IndustrySourcesResponse & { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Could not add source");
      setMode(data.mode);
      setSources(rowsFromApi(data));
      setNewUrl("");
      setAdding(false);
      setHint("Source added. Refresh digest to apply.");
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add source");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestoreAutomatic() {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const res = await fetch(`/api/daily-news/industry-publications/${encodeURIComponent(ticker)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Restore failed");
      setMode("auto");
      setHint("Restored automatic sources. Refresh digest to apply.");
      await load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Restore failed");
    } finally {
      setBusy(false);
    }
  }

  const label =
    mode === "none"
      ? "No sources"
      : sources.length > 0
        ? `${sources.length} source${sources.length === 1 ? "" : "s"}`
        : "Sources";

  return (
    <span ref={rootRef} className="relative mx-1 inline-block align-baseline">
      <button
        type="button"
        className="inline-flex items-center gap-0.5 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none"
        style={{
          borderColor: mode === "custom" ? "var(--accent)" : mode === "none" ? "var(--border2)" : "var(--border2)",
          color: mode === "custom" ? "var(--accent)" : mode === "none" ? "var(--muted)" : "var(--muted2)",
          background: "var(--card)",
        }}
        onClick={() => setOpen((v) => !v)}
        title="Industry news sources for this ticker"
        aria-expanded={open}
        aria-haspopup="true"
      >
        {label}
        <span aria-hidden style={{ fontSize: "8px" }}>
          ▾
        </span>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-[220] mt-1 min-w-[14rem] max-w-[18rem] rounded-md border py-2 shadow-lg"
          style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          role="menu"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            Industry sources · {ticker}
          </div>
          <div className="px-3 pb-2 text-[10px]" style={{ color: "var(--muted2)" }}>
            {mode === "custom"
              ? "Custom list"
              : mode === "none"
                ? "No industry sources"
                : "Automatic (SIC-based)"}
          </div>

          {loading ? (
            <p className="px-3 py-2 text-xs" style={{ color: "var(--muted2)" }}>
              Loading…
            </p>
          ) : (
            <ul className="max-h-48 overflow-y-auto">
              {sources.length === 0 ? (
                <li className="px-3 py-1.5 text-xs" style={{ color: "var(--muted2)" }}>
                  {mode === "none" ? "Industry news disabled for this ticker." : "No sources selected."}
                </li>
              ) : (
                sources.map((s, i) => (
                  <li
                    key={`${s.id}-${s.siteDomain}`}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-[var(--card)]"
                  >
                    <span className="min-w-0 flex-1 truncate font-medium" style={{ color: "var(--text)" }} title={s.siteDomain}>
                      {s.name}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] disabled:opacity-50"
                      style={{ color: "var(--danger, #ef4444)", border: "1px solid var(--border2)" }}
                      onClick={() => void handleDelete(i)}
                      title={`Remove ${s.name}`}
                    >
                      Delete
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}

          {mode !== "auto" ? (
            <button
              type="button"
              disabled={busy}
              className="mt-1 w-full border-t px-3 py-1.5 text-left text-[10px] disabled:opacity-50"
              style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
              onClick={(e) => {
                e.stopPropagation();
                void handleRestoreAutomatic();
              }}
            >
              Restore automatic (SIC-based)
            </button>
          ) : null}

          {adding ? (
            <div className="space-y-2 border-t px-3 pt-2" style={{ borderColor: "var(--border2)" }}>
              <input
                type="url"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://publication.com"
                className="w-full rounded border px-2 py-1 text-xs"
                style={{ borderColor: "var(--border)", background: "var(--card)", color: "var(--text)" }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === "Enter") void handleAddSource();
                  if (e.key === "Escape") {
                    setAdding(false);
                    setNewUrl("");
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || !newUrl.trim()}
                  className="rounded border px-2 py-0.5 text-[10px] font-semibold disabled:opacity-50"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  onClick={() => void handleAddSource()}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="rounded border px-2 py-0.5 text-[10px]"
                  style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                  onClick={() => {
                    setAdding(false);
                    setNewUrl("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={busy}
              className="mt-1 w-full border-t px-3 py-2 text-left text-xs font-medium disabled:opacity-50"
              style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
              onClick={(e) => {
                e.stopPropagation();
                if (sources.length >= MAX_CUSTOM_INDUSTRY_PUBLICATIONS) {
                  setError(`Maximum ${MAX_CUSTOM_INDUSTRY_PUBLICATIONS} sources. Delete one to add another.`);
                  setHint(null);
                  return;
                }
                setError(null);
                setAdding(true);
              }}
            >
              + Add new source
              {sources.length >= MAX_CUSTOM_INDUSTRY_PUBLICATIONS ? (
                <span className="ml-1 font-normal" style={{ color: "var(--muted2)" }}>
                  (delete one first)
                </span>
              ) : null}
            </button>
          )}

          {error ? (
            <p className="px-3 pt-2 text-[10px]" style={{ color: "var(--danger, #ef4444)" }}>
              {error}
            </p>
          ) : null}
          {hint ? (
            <p className="px-3 pt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
              {hint}
            </p>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}
