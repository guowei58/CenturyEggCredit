"use client";

import { useSession } from "next-auth/react";
import { useCallback, useState } from "react";
import { downloadPromptExportFilesToDownloads } from "@/lib/download-prompt-export-files";
import {
  canExportTickerPrompts,
  collectTickerPromptExport,
  listTickerPromptExportFiles,
} from "@/lib/export-ticker-prompts";

export function DownloadAllPromptsButton({
  ticker,
  companyName,
}: {
  ticker: string | null;
  companyName?: string | null;
}) {
  const { data: session, status } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const safeTicker = ticker?.trim().toUpperCase() ?? "";
  const allowed = status === "authenticated" && canExportTickerPrompts(session?.user?.email);

  const onDownload = useCallback(async () => {
    if (!safeTicker || busy) return;
    setError(null);
    setBusy(true);
    try {
      const bundle = collectTickerPromptExport({
        ticker: safeTicker,
        companyName,
        appOrigin: typeof window !== "undefined" ? window.location.origin : "",
      });
      const files = listTickerPromptExportFiles(bundle);
      await downloadPromptExportFilesToDownloads(safeTicker, files);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  }, [safeTicker, companyName, busy]);

  if (!allowed || !safeTicker) {
    return null;
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={() => void onDownload()}
        disabled={busy}
        className="btn-shell hi inline-flex shrink-0 items-center rounded-md px-3 py-2 text-[11px] font-semibold shadow-md transition-[box-shadow,opacity] hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
        style={{
          color: "var(--text)",
          borderColor: "var(--border2)",
          background: "color-mix(in srgb, var(--card2) 65%, var(--card))",
          boxShadow: "0 1px 0 color-mix(in srgb, var(--border2) 60%, transparent)",
        }}
        title={`Download Overview, Industry & Competition, Capital Structure, and Research prompts as .txt files in your Downloads folder (${safeTicker}-prompts/)`}
      >
        {busy ? "Downloading…" : "Download All Prompts"}
      </button>
      {error ? (
        <span className="max-w-[min(220px,45vw)] text-right text-[10px] leading-tight" style={{ color: "var(--danger, #f87171)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
