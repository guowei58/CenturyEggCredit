"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";

type UploadedFileItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
  contentType: string;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const digits = i === 0 ? 0 : i === 1 ? 1 : 2;
  return `${v.toFixed(digits)} ${units[i]}`;
}

export function CreditAgreementsFilesBox({
  ticker,
  apiBasePath = "/api/credit-agreements-files",
  emptyMessage = "Select a company to upload debt documents (PDF, Word, Excel, etc.).",
}: {
  ticker: string;
  apiBasePath?: string;
  emptyMessage?: string;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [items, setItems] = useState<UploadedFileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const listUrl = useMemo(() => `${apiBasePath}/${encodeURIComponent(safeTicker)}`, [apiBasePath, safeTicker]);

  async function refresh() {
    if (!safeTicker) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(listUrl);
      const body = (await res.json()) as { items?: UploadedFileItem[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load uploaded files.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setItems([]);
      setStatus(e instanceof Error ? e.message : "Failed to load uploaded files.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh uses stable memoized URL
  }, [safeTicker, listUrl]);

  async function uploadFiles(fileList: FileList | null) {
    if (!safeTicker || !fileList || fileList.length === 0) return;
    setUploading(true);
    setStatus(null);
    try {
      const fd = new FormData();
      Array.from(fileList).forEach((f) => {
        fd.append("file", f);
        fd.append("filename", f.name);
      });
      const res = await fetch(listUrl, { method: "POST", body: fd });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Upload failed.");
      setStatus(`Uploaded ${fileList.length} file${fileList.length === 1 ? "" : "s"}.`);
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  async function removeItem(it: UploadedFileItem) {
    if (!safeTicker) return;
    setStatus(null);
    try {
      const url = `${listUrl}?file=${encodeURIComponent(it.filename)}`;
      const res = await fetch(url, { method: "DELETE" });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Delete failed.");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Delete failed.");
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Debt documents">
        <p className="text-sm py-3" style={{ color: "var(--muted2)" }}>
          {emptyMessage}
        </p>
      </Card>
    );
  }

  return (
    <Card title="Debt documents (uploads)">
      <div className="flex items-center justify-between gap-3">
        <label className="inline-flex items-center gap-2 text-xs font-medium" style={{ color: "var(--muted2)" }}>
          <input
            type="file"
            multiple
            onChange={(e) => void uploadFiles(e.target.files)}
            disabled={uploading}
            className="block w-full text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border px-2.5 py-1.5 text-xs font-medium"
          style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
          disabled={loading}
        >
          Refresh
        </button>
      </div>

      <div className="mt-3 text-[11px]" style={{ color: "var(--muted2)" }}>
        Upload PDFs, Word, Excel, PowerPoint, etc. Files are stored per ticker and can be downloaded later.
      </div>

      {status && (
        <div className="mt-3 rounded border px-3 py-2 text-xs" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
          {status}
        </div>
      )}

      <div className="mt-4">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-xs" style={{ color: "var(--muted2)" }}>
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
            Loading…
          </div>
        ) : items.length === 0 ? (
          <div className="rounded border px-3 py-3 text-xs" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
            No uploaded files yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded border" style={{ borderColor: "var(--border2)" }}>
            <table className="w-full text-left text-xs" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "var(--card2)" }}>
                  <th className="px-3 py-2" style={{ color: "var(--muted2)" }}>File</th>
                  <th className="px-3 py-2" style={{ color: "var(--muted2)" }}>Saved</th>
                  <th className="px-3 py-2" style={{ color: "var(--muted2)" }}>Size</th>
                  <th className="px-3 py-2" style={{ color: "var(--muted2)" }}></th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const downloadUrl = `${listUrl}?file=${encodeURIComponent(it.filename)}`;
                  return (
                    <tr key={it.id} style={{ borderTop: "1px solid var(--border2)" }}>
                      <td className="px-3 py-2" style={{ color: "var(--text)" }}>
                        <a
                          className="underline"
                          style={{ color: "var(--accent)" }}
                          href={downloadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={it.contentType}
                        >
                          {it.originalName}
                        </a>
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted2)" }}>
                        {new Date(it.savedAtIso).toLocaleString()}
                      </td>
                      <td className="px-3 py-2" style={{ color: "var(--muted2)" }}>
                        {formatBytes(it.bytes)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button
                          type="button"
                          onClick={() => void removeItem(it)}
                          className="rounded border px-2 py-1 text-[11px] font-medium"
                          style={{ borderColor: "var(--border2)", color: "var(--muted2)", background: "transparent" }}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

