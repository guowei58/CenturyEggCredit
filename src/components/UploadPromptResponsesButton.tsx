"use client";

import { useSession } from "next-auth/react";
import { useCallback, useRef, useState } from "react";
import { canExportTickerPrompts } from "@/lib/export-ticker-prompts";
import {
  importTickerResponseFiles,
  readImportFilesFromFileList,
  type ImportTickerResponsesResult,
} from "@/lib/import-ticker-responses";

export function UploadPromptResponsesButton({
  ticker,
}: {
  ticker: string | null;
}) {
  const { data: session, status } = useSession();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportTickerResponsesResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const safeTicker = ticker?.trim().toUpperCase() ?? "";
  const allowed = status === "authenticated" && canExportTickerPrompts(session?.user?.email);

  const onPickFiles = useCallback(async (fileList: FileList | null) => {
    if (!safeTicker || !fileList?.length || busy) return;
    setError(null);
    setResult(null);
    setBusy(true);
    try {
      const files = await readImportFilesFromFileList(fileList);
      if (files.length === 0) {
        setError("No .txt, .md, .html, or .xlsx files found.");
        return;
      }
      const importResult = await importTickerResponseFiles(safeTicker, files);
      setResult(importResult);
      if (importResult.saved.length === 0 && importResult.failed.length === 0) {
        setError(
          "No files matched a tab name. Use the tab name (e.g. Business Overview.txt) or numbered deliverables (e.g. 01_business-overview.txt)."
        );
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }, [safeTicker, busy]);

  if (!allowed || !safeTicker) {
    return null;
  }

  const summary =
    result &&
    `${result.saved.length} saved` +
      (result.skipped.length ? ` · ${result.skipped.length} skipped` : "") +
      (result.failed.length ? ` · ${result.failed.length} failed` : "");

  return (
    <div className="flex flex-col items-end gap-0.5">
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".zip,.txt,.md,.html,.htm,.xlsx"
        className="hidden"
        onChange={(e) => void onPickFiles(e.target.files)}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="btn-shell hi inline-flex shrink-0 items-center rounded-md px-3 py-2 text-[11px] font-semibold shadow-md transition-[box-shadow,opacity] hover:shadow-lg disabled:pointer-events-none disabled:opacity-50"
        style={{
          color: "var(--text)",
          borderColor: "var(--border2)",
          background: "color-mix(in srgb, var(--card2) 65%, var(--card))",
          boxShadow: "0 1px 0 color-mix(in srgb, var(--border2) 60%, transparent)",
        }}
        title="Upload prompt answer files (.txt/.md/.xlsx or .zip). Name each file after its tab (e.g. Business Overview.txt)."
      >
        {busy ? "Uploading…" : "Upload Responses"}
      </button>
      {summary ? (
        <span className="max-w-[min(260px,50vw)] text-right text-[10px] leading-tight" style={{ color: "var(--muted2)" }}>
          {summary}
          {result?.failed.length ? (
            <span style={{ color: "var(--danger, #f87171)" }}>
              {" "}
              — {result.failed.map((f) => `${f.filename}: ${f.error}`).join("; ")}
            </span>
          ) : null}
        </span>
      ) : null}
      {error ? (
        <span className="max-w-[min(260px,50vw)] text-right text-[10px] leading-tight" style={{ color: "var(--danger, #f87171)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}
