"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  WorkProductIngestCatalog,
  WorkProductIngestCatalogEntry,
  WorkProductIngestSourceId,
} from "@/lib/work-product-ingest-additions";
import type { WorkProductIngestTabKind } from "@/lib/work-product-ingest-additions";

const CATEGORY_LABELS: Record<WorkProductIngestCatalogEntry["category"], string> = {
  work_product: "Work product outputs",
  saved_tab: "Saved tab responses",
  saved_document: "Saved documents",
  workspace_file: "Workspace uploads",
};

type Props = {
  kind: WorkProductIngestTabKind;
  ticker: string;
  needsSignIn?: boolean;
  /** When parent sources refresh, pass a new value to reload the catalog if the panel is open. */
  refreshKey?: string | null;
};

export function WorkProductIngestSourcePicker({ kind, ticker, needsSignIn, refreshKey }: Props) {
  const safeTicker = (ticker ?? "").trim().toUpperCase();
  const [catalog, setCatalog] = useState<WorkProductIngestCatalog | null>(null);
  const [draftIds, setDraftIds] = useState<WorkProductIngestSourceId[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    if (!safeTicker || needsSignIn) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/work-product-ingest/${encodeURIComponent(kind)}/${encodeURIComponent(safeTicker)}`
      );
      const body = (await res.json()) as { ok?: boolean; error?: string; catalog?: WorkProductIngestCatalog };
      if (!res.ok || !body.catalog) throw new Error(body.error ?? "Failed to load ingestion catalog");
      setCatalog(body.catalog);
      setDraftIds(body.catalog.pendingSourceIds);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [safeTicker, kind, needsSignIn]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load, refreshKey]);

  const availableEntries = useMemo(() => {
    if (!catalog) return [];
    const q = filter.trim().toLowerCase();
    return catalog.entries.filter((e) => {
      if (e.isDefault) return false;
      if (!q) return true;
      return e.label.toLowerCase().includes(q) || e.filename.toLowerCase().includes(q);
    });
  }, [catalog, filter]);

  const grouped = useMemo(() => {
    const map = new Map<WorkProductIngestCatalogEntry["category"], WorkProductIngestCatalogEntry[]>();
    for (const entry of availableEntries) {
      if (!map.has(entry.category)) map.set(entry.category, []);
      map.get(entry.category)!.push(entry);
    }
    return map;
  }, [availableEntries]);

  const dirty = useMemo(() => {
    if (!catalog) return false;
    const a = [...draftIds].sort().join("|");
    const b = [...catalog.pendingSourceIds].sort().join("|");
    return a !== b;
  }, [catalog, draftIds]);

  function toggle(id: WorkProductIngestSourceId) {
    setDraftIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function save() {
    if (!safeTicker || needsSignIn) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/work-product-ingest/${encodeURIComponent(kind)}/${encodeURIComponent(safeTicker)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ addedSourceIds: draftIds }),
        }
      );
      const body = (await res.json()) as { ok?: boolean; error?: string; catalog?: WorkProductIngestCatalog };
      if (!res.ok || !body.catalog) throw new Error(body.error ?? "Failed to save");
      setCatalog(body.catalog);
      setDraftIds(body.catalog.pendingSourceIds);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (needsSignIn) return null;

  const appliedCount = catalog?.userAddedSourceIds.length ?? 0;
  const hasUnappliedPending = catalog?.hasUnappliedPending === true;

  return (
    <div className="rounded border text-xs mt-2" style={{ borderColor: "var(--border2)" }}>
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
        <div style={{ color: "var(--muted2)" }}>
          <span className="font-medium" style={{ color: "var(--text)" }}>
            Extra ingestion sources
          </span>
          {appliedCount > 0 ? (
            <span className="ml-2">· {appliedCount} ingested</span>
          ) : (
            <span className="ml-2">· none ingested</span>
          )}
          {hasUnappliedPending ? (
            <span className="ml-2" style={{ color: "var(--warn)" }}>
              · saved selection not applied — click Refresh sources
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded border px-2 py-1 text-[11px] font-medium"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          {open ? "Close" : "Add sources…"}
        </button>
      </div>

      {catalog && appliedCount > 0 ? (
        <ul className="border-t px-3 py-2 space-y-1" style={{ borderColor: "var(--border2)" }}>
          {catalog.entries
            .filter((e) => e.isUserAdded)
            .map((e) => (
              <li key={e.id} className="truncate text-[11px]" style={{ color: "var(--text)" }} title={e.label}>
                + {e.label}
              </li>
            ))}
        </ul>
      ) : null}

      {open ? (
        <div className="border-t px-3 py-2 space-y-2" style={{ borderColor: "var(--border2)" }}>
          {loading && !catalog ? (
            <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
              Loading available sources…
            </p>
          ) : null}
          <p className="text-[10px]" style={{ color: "var(--muted)" }}>
            Default sources for this tab stay included automatically. Select additional saved tabs, saved documents,
            workspace files, or work product outputs below, then click <strong>Save selection</strong>. Your picks are
            ingested only when you click <strong>Refresh sources</strong> on this tab.
          </p>
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter by name…"
            className="w-full rounded border px-2 py-1 text-[11px]"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card)" }}
          />
          <div className="max-h-48 overflow-y-auto space-y-3">
            {[...grouped.entries()].map(([category, entries]) => (
              <div key={category}>
                <div className="text-[10px] font-semibold uppercase tracking-wide mb-1" style={{ color: "var(--muted2)" }}>
                  {CATEGORY_LABELS[category]}
                </div>
                <ul className="space-y-1">
                  {entries.map((e) => (
                    <li key={e.id}>
                      <label className="flex items-start gap-2 cursor-pointer text-[11px]" style={{ color: "var(--text)" }}>
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={draftIds.includes(e.id)}
                          onChange={() => toggle(e.id)}
                        />
                        <span className="min-w-0">
                          <span className="block truncate" title={e.label}>
                            {e.label}
                          </span>
                          <span className="font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                            {e.charsEstimate.toLocaleString()} chars
                            {e.category === "saved_document" || e.category === "workspace_file"
                              ? " extracted"
                              : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {availableEntries.length === 0 ? (
              <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                {loading ? "Loading…" : "No additional sources available (save content on other tabs or upload files first)."}
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <button
              type="button"
              disabled={saving || !dirty}
              onClick={() => void save()}
              className="rounded border px-3 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "#fff", background: "var(--accent)" }}
            >
              {saving ? "Saving…" : "Save selection"}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setDraftIds(catalog?.pendingSourceIds ?? []);
                setOpen(false);
              }}
              className="rounded border px-3 py-1 text-[11px] font-medium disabled:opacity-50"
              style={{ borderColor: "var(--border2)", color: "var(--text)", background: "transparent" }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="px-3 py-2 text-[11px] border-t" style={{ borderColor: "var(--border2)", color: "var(--danger)" }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
