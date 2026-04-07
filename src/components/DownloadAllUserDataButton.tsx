"use client";

import { useSession } from "next-auth/react";
import { useCallback, useState } from "react";

type ExportManifest = {
  totalParts: number;
  parts: Array<{ part: number; filename: string }>;
};

/**
 * Downloads a ZIP of all server-stored workspace data for the signed-in user.
 * Uses a small JSON manifest + native `<a download>` navigations so the browser saves the file
 * from `Content-Disposition` without `fetch().blob()` (which often fails on large/long responses).
 */
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

export function DownloadAllUserDataButton({ className }: { className?: string }) {
  const { status } = useSession();
  const [busy, setBusy] = useState(false);
  const [busyHint, setBusyHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    setBusyHint("Preparing…");
    try {
      const origin = window.location.origin;
      const metaRes = await fetch(`${origin}/api/me/export-all-data?meta=1`, {
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
        const url = `${origin}/api/me/export-all-data?part=${part}`;
        triggerFileDownload(url, filename);
        if (i < manifest.parts.length - 1) {
          await new Promise((r) => setTimeout(r, 1500));
        }
      }

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
  }, []);

  if (status !== "authenticated") {
    return null;
  }

  return (
    <div className={`flex flex-col items-end gap-1 ${className ?? ""}`}>
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="btn-shell hi inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold shadow-md transition-[box-shadow,opacity] hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
        style={{
          color: "var(--accent)",
          borderColor: "var(--accent)",
          background: "color-mix(in srgb, var(--accent) 14%, var(--card))",
          boxShadow: "0 1px 0 color-mix(in srgb, var(--accent) 35%, transparent)",
        }}
        title="ZIP export: saved tabs, Saved Documents, workspace files, account JSON. Multiple ZIPs if your data is large."
        aria-label="Download all saved data as a ZIP file"
      >
        <DownloadIcon className="shrink-0 opacity-90" />
        {busy ? (busyHint ?? "Preparing…") : "Download all data"}
      </button>
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
