"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";

type DeckTemplateItem = {
  id: string;
  ticker: string;
  filename: string;
  originalName: string;
  savedAtIso: string;
  bytes: number;
};

export function AiCreditDeckTemplateFileBox({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [items, setItems] = useState<DeckTemplateItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const latestItem = items[0];
  const apiBasePath = "/api/ai-credit-deck-template";
  const latestOpenUrl = useMemo(() => {
    if (!latestItem) return "";
    return `${apiBasePath}/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(latestItem.filename)}`;
  }, [latestItem, safeTicker]);

  async function refresh() {
    if (!safeTicker) return;
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`);
      const body = (await res.json()) as { items?: DeckTemplateItem[]; error?: string };
      if (!res.ok) throw new Error(body?.error ?? "Failed to load deck templates.");
      setItems(Array.isArray(body.items) ? body.items : []);
    } catch (e) {
      setItems([]);
      setStatus(e instanceof Error ? e.message : "Failed to load deck templates.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!safeTicker) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [safeTicker]);

  async function handleUpload(file: File) {
    if (!safeTicker) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".pptx") && !lower.endsWith(".ppt")) {
      setStatus("Please upload a .pptx or .ppt file.");
      return;
    }
    setUploading(true);
    setStatus(null);
    try {
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("filename", file.name);
      const res = await fetch(`${apiBasePath}/${encodeURIComponent(safeTicker)}`, {
        method: "POST",
        body: form,
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || body.ok !== true) {
        throw new Error(body?.error ?? "Failed to upload template file.");
      }
      setStatus("Template file saved.");
      await refresh();
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Failed to upload template file.");
    } finally {
      setUploading(false);
    }
  }

  if (!safeTicker) {
    return (
      <Card title="Deck Template File">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to upload an AI Credit Deck template file.
        </p>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-3 text-sm font-semibold" style={{ color: "var(--text)" }}>
        Deck Template File
      </div>
      <div className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="file"
              accept=".ppt,.pptx,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation"
              className="text-xs"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void handleUpload(f);
              }}
              disabled={uploading || loading}
            />
            <div className="flex-1" />
            {latestItem && latestOpenUrl && (
              <a
                href={latestOpenUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline text-[12px]"
                style={{ color: "var(--accent)" }}
                title="Open saved deck template"
              >
                Open saved
              </a>
            )}
          </div>
          {status && (
            <div className="text-xs" style={{ color: "var(--muted2)" }}>
              {status}
            </div>
          )}
          <div className="text-[11px]" style={{ color: "var(--muted2)" }}>
            {latestItem
              ? `Latest: ${latestItem.filename}`
              : "No template uploaded yet. Upload the deck file you want AI to populate."}
          </div>
        </div>
      </div>
    </div>
  );
}

