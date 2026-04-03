"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, DataTable } from "@/components/ui";

type SavedItem = {
  id: string;
  title: string;
  filename: string;
  relativePath: string;
  originalUrl: string;
  contentType: string | null;
  savedAtIso: string;
  bytes: number;
  convertedToPdf: boolean;
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function CompanySavedDocumentsTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [urlInput, setUrlInput] = useState("");
  const [items, setItems] = useState<SavedItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const listUrl = useMemo(() => (safeTicker ? `/api/saved-documents/${encodeURIComponent(safeTicker)}` : ""), [safeTicker]);

  async function refresh(mode: "list" | "reconcile" = "list") {
    if (!listUrl) return;
    setLoading(true);
    setStatus(null);
    try {
      const url = mode === "reconcile" ? `${listUrl}?reconcile=1` : listUrl;
      const res = await fetch(url, { method: "GET" });
      const body = (await res.json()) as { items?: SavedItem[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load saved documents.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setItems([]);
      setStatus(e instanceof Error ? e.message : "Failed to load saved documents.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setUrlInput("");
    setItems([]);
    setStatus(null);
    if (safeTicker) void refresh("reconcile");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeTicker]);

  async function handleSaveUrl() {
    const u = urlInput.trim();
    if (!safeTicker || !u) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(listUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: u }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; item?: SavedItem; error?: string } | null;
      if (!res.ok || body?.ok !== true) {
        throw new Error(body?.error ?? `Failed to save document (HTTP ${res.status}).`);
      }
      setUrlInput("");
      setStatus(body.item?.convertedToPdf ? "Saved (converted to PDF)." : "Saved PDF.");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to save document.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteItem(it: SavedItem) {
    if (!safeTicker) return;
    const ok = window.confirm(`Delete "${it.title}"? This removes the stored document from your account.`);
    if (!ok) return;

    setDeletingId(it.id);
    setStatus(null);
    try {
      const res = await fetch(`/api/saved-documents/${encodeURIComponent(safeTicker)}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: it.filename }),
      });
      const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || body?.ok !== true) {
        throw new Error(body?.error ?? "Failed to delete document.");
      }
      await refresh();
      setStatus("Deleted.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to delete document.");
    } finally {
      setDeletingId(null);
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Saved Documents">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to save document URLs to your account for that ticker.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title={`Saved Documents — ${safeTicker}`}>
        <p className="text-sm mb-3" style={{ color: "var(--muted2)" }}>
          Paste a document URL. The server downloads it and stores the PDF in your account (database) for this ticker.
          Non-PDF pages are converted to PDF when possible. You must be signed in.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://…"
            className="min-w-0 flex-1 rounded-md border bg-[var(--card)] px-3 py-2 text-xs text-[var(--text)] placeholder:text-[var(--muted)] focus:border-[var(--accent)] focus:outline-none"
            style={{ borderColor: "var(--border2)" }}
          />
          <button
            type="button"
            onClick={handleSaveUrl}
            disabled={loading || urlInput.trim().length === 0}
            className="rounded-md border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            {loading ? "Saving…" : "Save URL"}
          </button>
          <button
            type="button"
            onClick={() => void refresh("list")}
            disabled={loading}
            className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
          >
            Refresh
          </button>
          <button
            type="button"
            onClick={() => void refresh("reconcile")}
            disabled={loading}
            className="rounded-md border px-3 py-2 text-xs font-medium disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            title="Reload list from server"
          >
            Reload list
          </button>
        </div>
        {status && (
          <p className="text-xs mt-2" style={{ color: "var(--muted2)" }}>
            {status}
          </p>
        )}
      </Card>

      <Card title={`Saved files (${items.length})`}>
        {items.length === 0 ? (
          <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
            No saved documents yet.
          </p>
        ) : (
          <DataTable>
            <thead>
              <tr>
                <th>Saved</th>
                <th>File</th>
                <th>Size</th>
                <th>Source</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                    {new Date(it.savedAtIso).toLocaleString()}
                  </td>
                  <td className="min-w-[220px]">
                    <div className="text-sm" style={{ color: "var(--text)" }}>{it.title}</div>
                    <div className="text-[10px]" style={{ color: "var(--muted)" }}>
                      {it.convertedToPdf ? "Converted to PDF" : it.contentType?.includes("pdf") ? "PDF" : "File"} ·{" "}
                      <span className="font-mono">{it.filename}</span>
                    </div>
                    <div className="mt-1">
                      <a
                        href={`/api/saved-documents/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(it.filename)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ color: "var(--blue)" }}
                      >
                        Open
                      </a>
                    </div>
                  </td>
                  <td className="font-mono text-[11px]" style={{ color: "var(--muted2)" }}>
                    {formatBytes(it.bytes)}
                  </td>
                  <td className="max-w-[420px]">
                    <a href={it.originalUrl} target="_blank" rel="noopener noreferrer" className="underline break-all" style={{ color: "var(--accent)" }}>
                      {it.originalUrl}
                    </a>
                    {it.contentType && (
                      <div className="text-[10px] mt-1" style={{ color: "var(--muted)" }}>
                        {it.contentType}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => handleDeleteItem(it)}
                      disabled={loading || deletingId === it.id}
                      className="rounded border px-3 py-1.5 text-[11px] font-medium disabled:opacity-50"
                      style={{
                        borderColor: "var(--danger)",
                        color: "var(--danger)",
                        background: "transparent",
                      }}
                    >
                      {deletingId === it.id ? "Deleting…" : "Delete"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        )}
      </Card>
    </div>
  );
}

