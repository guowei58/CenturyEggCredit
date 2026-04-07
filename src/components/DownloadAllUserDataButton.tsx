"use client";

import { useSession } from "next-auth/react";
import { useCallback, useEffect, useState } from "react";

type ExportManifest = {
  totalParts: number;
  parts: Array<{ part: number; filename: string }>;
};

type ExportMode = "all" | "selected";

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function triggerFileDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function tickerCheckboxLabel(sym: string): string {
  if (sym === "GLOBAL") return "GLOBAL (account-wide workspace)";
  return sym;
}

export function DownloadAllUserDataButton({ className }: { className?: string }) {
  const { status } = useSession();
  const [modalOpen, setModalOpen] = useState(false);
  const [mode, setMode] = useState<ExportMode>("all");
  const [tickers, setTickers] = useState<string[]>([]);
  const [tickersLoading, setTickersLoading] = useState(false);
  const [tickersError, setTickersError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen || status !== "authenticated") return;
    let cancelled = false;
    setTickersLoading(true);
    setTickersError(null);
    void (async () => {
      try {
        const res = await fetch(`${window.location.origin}/api/me/export-all-data?listTickers=1`, {
          credentials: "include",
        });
        const data = (await res.json()) as { ok?: boolean; tickers?: string[]; error?: string };
        if (!res.ok) throw new Error(data.error || "Could not load tickers");
        if (!cancelled) setTickers(Array.isArray(data.tickers) ? data.tickers : []);
      } catch (e) {
        if (!cancelled) setTickersError(e instanceof Error ? e.message : "Failed to load tickers");
      } finally {
        if (!cancelled) setTickersLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen, status]);

  useEffect(() => {
    if (!modalOpen) return;
    setMode("all");
    setSelected(new Set());
    setError(null);
    setInfo(null);
  }, [modalOpen]);

  const runExport = useCallback(async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setBusyHint("Preparing…");
    try {
      const origin = window.location.origin;
      const tickersQs =
        mode === "selected"
          ? `&tickers=${encodeURIComponent(Array.from(selected).sort().join(","))}`
          : "";

      if (mode === "selected" && selected.size === 0) {
        setError("Select at least one ticker, or choose “All tickers”.");
        setBusy(false);
        setBusyHint(null);
        return;
      }

      const metaRes = await fetch(`${origin}/api/me/export-all-data?meta=1${tickersQs}`, {
        method: "GET",
        credentials: "include",
      });
      if (!metaRes.ok) {
        const j = (await metaRes.json().catch(() => null)) as { error?: string } | null;
        throw new Error(j?.error ?? (metaRes.statusText || "Could not start export"));
      }
      const manifest = (await metaRes.json()) as ExportManifest;
      if (!manifest?.parts?.length) {
        throw new Error("Empty export manifest");
      }

      for (let i = 0; i < manifest.parts.length; i++) {
        const { part, filename } = manifest.parts[i];
        if (manifest.totalParts > 1) {
          setBusyHint(`Starting part ${part} of ${manifest.totalParts}…`);
        } else {
          setBusyHint("Starting download…");
        }
        const url = `${origin}/api/me/export-all-data?part=${part}${tickersQs}`;
        triggerFileDownload(url, filename);
        if (i < manifest.parts.length - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

      setModalOpen(false);
      setInfo(
        "Download should appear in your browser’s download bar or Downloads folder. If you see nothing, check blocked downloads or try again."
      );
      window.setTimeout(() => setInfo(null), 14_000);
    } catch (e) {
      console.error("[download-all-data]", e);
      const raw = e instanceof Error ? e.message : "Download failed";
      setError(
        raw === "Failed to fetch"
          ? "Could not reach the server for the export manifest. Check Network in DevTools, VPN/antivirus, and that the dev server is running."
          : raw
      );
    } finally {
      setBusy(false);
      setBusyHint(null);
    }
  }, [mode, selected]);

  function toggleTicker(sym: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sym)) next.delete(sym);
      else next.add(sym);
      return next;
    });
  }

  function selectAllTickers() {
    setSelected(new Set(tickers));
  }

  function clearTickers() {
    setSelected(new Set());
  }

  if (status !== "authenticated") {
    return null;
  }

  return (
    <div className={`flex flex-col items-end gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={() => setModalOpen(true)}
        disabled={busy}
        className="btn-shell hi inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold shadow-md transition-[box-shadow,opacity] hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
        style={{
          color: "var(--accent)",
          borderColor: "var(--accent)",
          background: "color-mix(in srgb, var(--accent) 14%, var(--card))",
          boxShadow: "0 1px 0 color-mix(in srgb, var(--accent) 35%, transparent)",
        }}
        title="Export saved data as ZIP — full account or chosen tickers only"
        aria-label="Open download options for saved data"
      >
        <DownloadIcon className="shrink-0 opacity-90" />
        Download all data
      </button>

      {modalOpen ? (
        <div
          className="fixed inset-0 z-[10050] flex items-center justify-center px-3 py-6"
          style={{ background: "rgba(0,0,0,0.55)" }}
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModalOpen(false);
          }}
        >
          <div
            className="max-h-[min(90vh,640px)] w-full max-w-md overflow-y-auto rounded-lg border p-5 shadow-xl"
            style={{
              borderColor: "var(--border2)",
              background: "var(--card)",
              color: "var(--text)",
            }}
            role="dialog"
            aria-labelledby="export-dialog-title"
            aria-modal="true"
          >
            <h2 id="export-dialog-title" className="text-base font-semibold tracking-tight">
              Export your data
            </h2>
            <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
              Account files (preferences, watchlist, AI chat state) are always included. Choose whether to include every ticker folder or only
              the ones you select.
            </p>

            <fieldset className="mt-4 space-y-2 border-0 p-0">
              <legend className="sr-only">Export scope</legend>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="export-scope"
                  className="mt-1"
                  checked={mode === "all"}
                  onChange={() => setMode("all")}
                />
                <span>
                  <span className="font-medium">All tickers</span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: "var(--muted2)" }}>
                    Full export: every saved tab, document, and workspace file for all symbols (and account-wide workspace).
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="export-scope"
                  className="mt-1"
                  checked={mode === "selected"}
                  onChange={() => setMode("selected")}
                />
                <span>
                  <span className="font-medium">Choose tickers</span>
                  <span className="mt-0.5 block text-[11px]" style={{ color: "var(--muted2)" }}>
                    Only folders under <code className="font-mono text-[10px]">tickers/&lt;SYMBOL&gt;/</code> for the symbols you check.
                  </span>
                </span>
              </label>
            </fieldset>

            {mode === "selected" ? (
              <div className="mt-4 rounded-md border p-3" style={{ borderColor: "var(--border2)" }}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                    Tickers
                  </span>
                  <button
                    type="button"
                    className="text-[11px] font-medium underline underline-offset-2 disabled:opacity-40"
                    style={{ color: "var(--accent)" }}
                    onClick={selectAllTickers}
                    disabled={tickers.length === 0 || tickersLoading}
                  >
                    Select all
                  </button>
                  <button
                    type="button"
                    className="text-[11px] font-medium underline underline-offset-2 disabled:opacity-40"
                    style={{ color: "var(--muted2)" }}
                    onClick={clearTickers}
                    disabled={selected.size === 0}
                  >
                    Clear
                  </button>
                </div>
                {tickersLoading ? (
                  <p className="text-xs" style={{ color: "var(--muted)" }}>
                    Loading symbols…
                  </p>
                ) : tickersError ? (
                  <p className="text-xs" style={{ color: "var(--danger, #f87171)" }}>
                    {tickersError}
                  </p>
                ) : tickers.length === 0 ? (
                  <p className="text-xs" style={{ color: "var(--muted2)" }}>
                    No ticker-scoped data yet. Use “All tickers” to download account files only, or add research data first.
                  </p>
                ) : (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-1">
                    {tickers.map((sym) => (
                      <li key={sym}>
                        <label className="flex cursor-pointer items-center gap-2 text-xs">
                          <input type="checkbox" checked={selected.has(sym)} onChange={() => toggleTicker(sym)} />
                          <span>{tickerCheckboxLabel(sym)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                className="rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                onClick={() => setModalOpen(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn-shell hi rounded-md px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{
                  color: "var(--accent)",
                  borderColor: "var(--accent)",
                  background: "color-mix(in srgb, var(--accent) 14%, var(--card))",
                }}
                disabled={busy || (mode === "selected" && selected.size === 0)}
                onClick={() => void runExport()}
              >
                {busy ? (busyHint ?? "Preparing…") : "Download ZIP"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {info ? (
        <span className="max-w-[min(300px,55vw)] text-right text-[10px] leading-tight" style={{ color: "var(--muted2)" }}>
          {info}
        </span>
      ) : null}
      {error ? (
        <span className="max-w-[min(280px,50vw)] text-right text-[10px] leading-tight" style={{ color: "var(--danger, #f87171)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
