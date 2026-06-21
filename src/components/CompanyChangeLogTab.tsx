"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import type { ChangeLogEntry, ChangeLogSavedUpdate, ChangeLogStore } from "@/lib/change-log/types";

type NextPeriod = {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  isFirstUpdate: boolean;
};

type SidebarSelection = { kind: "draft" } | { kind: "saved"; id: string };

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "Never";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function formatSidebarDate(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function ChangeLogBullet({
  entry,
  ticker,
  savedUrls,
}: {
  entry: ChangeLogEntry;
  ticker: string;
  savedUrls: Set<string>;
}) {
  const urlSaved =
    savedUrls.has(entry.sourceUrl) ||
    (entry.accessionNumber ? savedUrls.has(`sec:${entry.accessionNumber.replace(/\s+/g, "")}`) : false);

  return (
    <li className="flex gap-2 text-sm leading-relaxed" style={{ color: "var(--text)" }}>
      <span className="mt-0.5 shrink-0" style={{ color: "var(--muted2)" }}>
        •
      </span>
      <div className="min-w-0 flex-1">
        <span>{entry.body}</span>
        {entry.sourceUrl ? (
          <span className="ml-1 inline-flex flex-wrap items-center gap-1 align-middle">
            <a
              href={entry.sourceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-medium underline-offset-2 hover:underline"
              style={{ color: "var(--accent)" }}
            >
              {entry.sourceName || "Source"}
            </a>
            <SaveFilingLinkButton
              ticker={ticker}
              url={entry.sourceUrl}
              mode="saved-documents"
              saveTitle={entry.headline || entry.body.slice(0, 120)}
              alreadySaved={urlSaved}
              className="ml-0 px-1.5 py-0 normal-case text-[10px]"
            />
          </span>
        ) : null}
      </div>
    </li>
  );
}

function ChangeLogBulletList({
  entries,
  ticker,
  savedUrls,
}: {
  entries: ChangeLogEntry[];
  ticker: string;
  savedUrls: Set<string>;
}) {
  const sorted = useMemo(
    () => [...entries].sort((a, b) => b.date.localeCompare(a.date) || a.body.localeCompare(b.body)),
    [entries]
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        No items in this update.
      </p>
    );
  }

  return (
    <ul className="space-y-3">
      {sorted.map((entry) => (
        <ChangeLogBullet key={entry.id} entry={entry} ticker={ticker} savedUrls={savedUrls} />
      ))}
    </ul>
  );
}

export function CompanyChangeLogTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [store, setStore] = useState<ChangeLogStore | null>(null);
  const [nextPeriod, setNextPeriod] = useState<NextPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftEntries, setDraftEntries] = useState<ChangeLogEntry[]>([]);
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<SidebarSelection | null>(null);

  const load = useCallback(async () => {
    if (!safeTicker) return;
    setLoading(true);
    setError(null);
    try {
      const [clRes, docsRes] = await Promise.all([
        fetch(`/api/change-log/${encodeURIComponent(safeTicker)}`),
        fetch(`/api/saved-documents/${encodeURIComponent(safeTicker)}`),
      ]);
      if (!clRes.ok) throw new Error("Failed to load Key Updates");
      const data = (await clRes.json()) as { store: ChangeLogStore; nextUpdatePeriod: NextPeriod };
      setStore(data.store);
      setNextPeriod(data.nextUpdatePeriod);
      if (data.store.draft?.status === "ready") {
        setDraftEntries(data.store.draft.entries);
        setSelection({ kind: "draft" });
      } else {
        setDraftEntries([]);
        const first = data.store.updates[0];
        setSelection(first ? { kind: "saved", id: first.id } : null);
      }

      if (docsRes.ok) {
        const docs = (await docsRes.json()) as { items?: Array<{ originalUrl?: string }> };
        const urls = new Set<string>();
        for (const it of docs.items ?? []) {
          if (it.originalUrl) urls.add(it.originalUrl);
        }
        setSavedUrls(urls);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [safeTicker]);

  useEffect(() => {
    void load();
  }, [load]);

  const draftReady = store?.draft?.status === "ready";
  const draftRunning = store?.draft?.status === "running" || updating;
  const draftFailed = store?.draft?.status === "failed";

  const savedUpdates = store?.updates ?? [];

  const selectedSaved: ChangeLogSavedUpdate | null = useMemo(() => {
    if (selection?.kind !== "saved") return null;
    return savedUpdates.find((u) => u.id === selection.id) ?? null;
  }, [selection, savedUpdates]);

  const onUpdate = async () => {
    if (!safeTicker || updating) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/change-log/${encodeURIComponent(safeTicker)}/update`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as {
        store?: ChangeLogStore;
        error?: string;
        meta?: { fetchErrors?: string[]; sec?: { error?: string | null; secCandidates?: number } };
      };
      if (!res.ok) throw new Error(data.error ?? "Update failed");
      if (data.store) {
        setStore(data.store);
        setDraftEntries(data.store.draft?.entries ?? []);
        if (data.store.draft?.status === "ready") setSelection({ kind: "draft" });
      }
      const msgs: string[] = [];
      if (data.meta?.sec?.error) msgs.push(`SEC: ${data.meta.sec.error}`);
      if (data.meta?.fetchErrors?.length) msgs.push(...data.meta.fetchErrors.slice(0, 2));
      if (msgs.length) setError(msgs.join(" · "));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
      await load();
    } finally {
      setUpdating(false);
    }
  };

  const onSaveDraft = async () => {
    if (!safeTicker || !store?.draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/change-log/${encodeURIComponent(safeTicker)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          saveUpdate: {
            periodStart: store.draft.periodStart,
            periodEnd: store.draft.periodEnd,
            periodLabel: store.draft.periodLabel,
            entries: draftEntries,
          },
        }),
      });
      const data = (await res.json()) as {
        store?: ChangeLogStore;
        savedUpdate?: ChangeLogSavedUpdate;
        error?: string;
      };
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      if (data.store) {
        setStore(data.store);
        setDraftEntries([]);
        const savedId = data.savedUpdate?.id ?? data.store.updates[0]?.id;
        if (savedId) setSelection({ kind: "saved", id: savedId });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const onDiscardDraft = async () => {
    if (!safeTicker) return;
    try {
      const res = await fetch(`/api/change-log/${encodeURIComponent(safeTicker)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ discardDraft: true }),
      });
      const data = (await res.json()) as { store?: ChangeLogStore };
      if (data.store) {
        setStore(data.store);
        setDraftEntries([]);
        const first = data.store.updates[0];
        setSelection(first ? { kind: "saved", id: first.id } : null);
      }
    } catch {
      /* ignore */
    }
  };

  if (!safeTicker) return null;

  const showingDraft = selection?.kind === "draft" && draftReady;
  const contentEntries = showingDraft ? draftEntries : (selectedSaved?.entries ?? []);
  const contentPeriodLabel = showingDraft
    ? store?.draft?.periodLabel
    : selectedSaved?.periodLabel;
  const contentSavedAt = showingDraft ? null : selectedSaved?.savedAt;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-3 shrink-0 px-1">
        <h1 className="text-lg font-bold" style={{ color: "var(--text)" }}>
          Key Updates
        </h1>
        {companyName ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            {companyName} ({safeTicker})
          </p>
        ) : (
          <p className="font-mono text-sm" style={{ color: "var(--muted2)" }}>
            {safeTicker}
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 gap-0 overflow-hidden rounded-lg border" style={{ borderColor: "var(--border2)" }}>
        {/* Left sidebar — updates by date */}
        <aside
          className="flex w-52 shrink-0 flex-col border-r sm:w-56"
          style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
        >
          <div className="border-b p-3" style={{ borderColor: "var(--border2)" }}>
            <button
              type="button"
              onClick={() => void onUpdate()}
              disabled={draftRunning || saving}
              className="w-full rounded-md px-3 py-2 text-xs font-semibold disabled:opacity-60"
              style={{ color: "var(--accent-fg)", background: "var(--accent)" }}
            >
              {draftRunning ? "Updating…" : "Update"}
            </button>
            <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
              Last saved: {formatDateTime(store?.lastChangeLogUpdatedAt)}
            </p>
          </div>

          <nav className="min-h-0 flex-1 overflow-y-auto p-2" aria-label="Key Updates history">
            {draftReady ? (
              <button
                type="button"
                onClick={() => setSelection({ kind: "draft" })}
                className="mb-1 w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors"
                style={{
                  background: selection?.kind === "draft" ? "var(--accent)" : "transparent",
                  color: selection?.kind === "draft" ? "var(--accent-fg)" : "var(--text)",
                }}
              >
                <span className="block font-semibold">Draft</span>
                <span
                  className="block truncate text-[10px]"
                  style={{ color: selection?.kind === "draft" ? "var(--accent-fg)" : "var(--muted)" }}
                >
                  {store?.draft?.periodLabel}
                </span>
              </button>
            ) : null}

            {savedUpdates.map((update) => {
              const active = selection?.kind === "saved" && selection.id === update.id;
              return (
                <button
                  key={update.id}
                  type="button"
                  onClick={() => setSelection({ kind: "saved", id: update.id })}
                  className="mb-1 w-full rounded-md px-2.5 py-2 text-left text-xs transition-colors"
                  style={{
                    background: active ? "var(--accent)" : "transparent",
                    color: active ? "var(--accent-fg)" : "var(--text)",
                  }}
                >
                  <span className="block font-semibold">{formatSidebarDate(update.savedAt)}</span>
                  <span
                    className="block truncate text-[10px]"
                    style={{ color: active ? "var(--accent-fg)" : "var(--muted)" }}
                  >
                    {update.periodLabel}
                  </span>
                  <span
                    className="block text-[10px]"
                    style={{ color: active ? "var(--accent-fg)" : "var(--muted2)" }}
                  >
                    {update.entries.length} item{update.entries.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}

            {!draftReady && savedUpdates.length === 0 && !loading ? (
              <p className="px-2 py-3 text-[11px]" style={{ color: "var(--muted)" }}>
                No saved updates yet.
              </p>
            ) : null}
          </nav>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 overflow-y-auto p-4 sm:p-5">
          {loading ? (
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Loading…
            </p>
          ) : null}

          {error ? (
            <p
              className="mb-3 rounded border px-3 py-2 text-sm"
              style={{ borderColor: "var(--danger)", color: "var(--danger)" }}
            >
              {error}
            </p>
          ) : null}

          {draftRunning && !draftReady ? (
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Searching sources and generating AI summaries for {nextPeriod?.periodLabel ?? "the update period"}…
            </p>
          ) : null}

          {draftFailed && store?.draft ? (
            <div className="mb-3">
              <p className="text-sm" style={{ color: "var(--danger)" }}>
                {store.draft.error ?? "Update failed."}
              </p>
              <button
                type="button"
                onClick={() => void onDiscardDraft()}
                className="mt-2 text-xs underline"
                style={{ color: "var(--muted2)" }}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {(showingDraft || selectedSaved) && !draftRunning ? (
            <>
              <div className="mb-4">
                <h2 className="text-sm font-bold" style={{ color: "var(--text)" }}>
                  {showingDraft ? "Draft" : "Update"} · {contentPeriodLabel}
                </h2>
                {contentSavedAt ? (
                  <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                    Saved {formatDateTime(contentSavedAt)}
                    {selectedSaved?.savedByUserName || selectedSaved?.savedByUserEmail
                      ? ` · ${selectedSaved.savedByUserName ?? selectedSaved.savedByUserEmail}`
                      : ""}
                  </p>
                ) : (
                  <p className="text-[11px]" style={{ color: "var(--muted)" }}>
                    Review AI summaries, then save to record this update.
                  </p>
                )}
                {!showingDraft && nextPeriod ? (
                  <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
                    Next period when you update: {nextPeriod.periodLabel}
                  </p>
                ) : null}
              </div>

              <ChangeLogBulletList entries={contentEntries} ticker={safeTicker} savedUrls={savedUrls} />

              {showingDraft ? (
                <div className="mt-6 flex flex-wrap gap-2 border-t pt-4" style={{ borderColor: "var(--border2)" }}>
                  <button
                    type="button"
                    onClick={() => void onSaveDraft()}
                    disabled={saving || draftEntries.length === 0}
                    className="rounded-md px-4 py-2 text-xs font-semibold disabled:opacity-60"
                    style={{ background: "var(--accent)", color: "var(--accent-fg)" }}
                  >
                    {saving ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void onDiscardDraft()}
                    disabled={saving}
                    className="rounded-md border px-4 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
                  >
                    Discard
                  </button>
                </div>
              ) : null}
            </>
          ) : !loading && !draftRunning && savedUpdates.length === 0 && !draftReady ? (
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Click <strong>Update</strong> to pull filings and news, summarize them with AI, and build your
              first update.
            </p>
          ) : !loading && !draftRunning && !showingDraft && !selectedSaved ? (
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Select an update from the left, or run a new update.
            </p>
          ) : null}
        </main>
      </div>
    </div>
  );
}
