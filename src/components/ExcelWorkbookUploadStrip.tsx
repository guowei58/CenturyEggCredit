"use client";

import { useRef, useState } from "react";

type ExcelWorkbookUploadStripProps = {
  uploading: boolean;
  loading: boolean;
  status: string | null;
  fileName?: string;
  latestItem: unknown;
  latestOpenUrl: string | null;
  handleUpload: (file: File) => void | Promise<void>;
};

export function ExcelWorkbookUploadStrip({
  uploading,
  loading,
  status,
  fileName = "",
  latestItem,
  latestOpenUrl,
  handleUpload,
}: ExcelWorkbookUploadStripProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pickedName, setPickedName] = useState("");
  const displayName = fileName.trim() || pickedName.trim();
  const busy = uploading || loading;

  return (
    <div className="excel-workbook-upload-strip excel-workbook-upload-strip--single-row">
      <span className="excel-workbook-upload-strip-label">Excel</span>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="excel-workbook-upload-strip-file-input"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setPickedName(f.name);
          void handleUpload(f);
        }}
        disabled={busy}
      />
      <button
        type="button"
        className="excel-workbook-upload-strip-choose"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        Choose file
      </button>
      <span
        className={`excel-workbook-upload-strip-name${displayName ? "" : " excel-workbook-upload-strip-name--empty"}`}
        title={displayName || "No file chosen"}
      >
        {displayName || "No file chosen"}
      </span>
      {latestItem && latestOpenUrl ? (
        <a
          href={latestOpenUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="excel-workbook-upload-strip-link"
        >
          Open saved
        </a>
      ) : null}
      {status ? <span className="excel-workbook-upload-strip-status">{status}</span> : null}
    </div>
  );
}
