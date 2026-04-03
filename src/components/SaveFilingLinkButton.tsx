"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveRemoteUrlForTicker, type SaveRemoteUrlMode } from "@/lib/save-remote-url-client";

type Phase = "idle" | "saving" | "ok" | "err";

export function SaveFilingLinkButton({
  ticker,
  url,
  className = "",
  mode = "filings",
}: {
  ticker: string;
  url: string;
  className?: string;
  /** `saved-documents`: any http(s) URL (Saved Documents tab pipeline). `filings`: SEC/FCC/USPTO allowlist only. */
  mode?: SaveRemoteUrlMode;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const safeUrl = url?.trim() ?? "";
  const [phase, setPhase] = useState<Phase>("idle");
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const okTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (okTimer.current) clearTimeout(okTimer.current);
    };
  }, []);

  const onClick = useCallback(async () => {
    if (!safeTicker || !safeUrl) return;
    if (okTimer.current) {
      clearTimeout(okTimer.current);
      okTimer.current = null;
    }
    setPhase("saving");
    setErrMsg(null);
    try {
      const result = await saveRemoteUrlForTicker(safeTicker, safeUrl, mode);
      if (!result.ok) {
        setErrMsg(result.error);
        setPhase("err");
        return;
      }
      setPhase("ok");
      okTimer.current = setTimeout(() => {
        setPhase("idle");
        okTimer.current = null;
      }, 2200);
    } catch (e) {
      setErrMsg(e instanceof Error ? e.message : "Save failed.");
      setPhase("err");
    }
  }, [safeTicker, safeUrl, mode]);

  if (!safeTicker || !safeUrl) return null;

  const label =
    phase === "saving" ? "…" : phase === "ok" ? "Saved" : phase === "err" ? "Retry" : "Save";

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      disabled={phase === "saving"}
      title={
        errMsg && phase === "err"
          ? errMsg
          : mode === "saved-documents"
            ? "Save this URL to your ticker folder (Saved Documents, as PDF)"
            : "Save this page to your ticker folder (Saved Documents, as PDF)"
      }
      className={`ml-1.5 inline-flex shrink-0 items-center rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition disabled:opacity-60 ${className}`}
      style={{
        borderColor: phase === "ok" ? "var(--accent)" : "var(--border2)",
        color:
          phase === "err"
            ? "var(--danger)"
            : phase === "ok"
              ? "var(--accent)"
              : "var(--muted2)",
        background: phase === "ok" ? "var(--card2)" : "transparent",
      }}
    >
      {label}
    </button>
  );
}
