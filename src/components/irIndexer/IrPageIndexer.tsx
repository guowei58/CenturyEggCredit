"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useUserPreferences } from "@/components/UserPreferencesProvider";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import type { IrAsset, IrAssetType, IrSection, IndexedIrSummary, IrIngestionJob, IrSource } from "@/lib/irIndexer/types";

type SourcePayload = {
  source: IrSource;
  summary: IndexedIrSummary | null;
  latestJob: IrIngestionJob | null;
};

type IrUrlCandidate = { url: string; confidence?: string; notes?: string };

const TABS = ["Indexer Overview", "Page Sections", "PDFs", "SEC Filings", "Other Links"] as const;
type Tab = (typeof TABS)[number];

function labelType(t: IrAssetType): string {
  return t
    .replace(/_/g, " ")
    .replace(/\bsec\b/i, "SEC")
    .replace(/\bpdf\b/i, "PDF")
    .replace(/\bwebcast\b/i, "Webcast")
    .replace(/\bhtml\b/i, "HTML")
    .replace(/\b(?:^|\s)\w/g, (m) => m.toUpperCase());
}

export function IrPageIndexer({ ticker }: { ticker: string }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { ready: prefsReady, preferences, updatePreferences } = useUserPreferences();
  const irIndexer = preferences.irIndexer;
  const irRowForTicker = tk ? irIndexer?.[tk] : undefined;

  const [url, setUrl] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("Indexer Overview");
  const [sourceId, setSourceId] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<SourcePayload | null>(null);

  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestCandidates, setSuggestCandidates] = useState<IrUrlCandidate[] | null>(null);

  const [sections, setSections] = useState<Array<IrSection & { page: { url: string; title: string | null; depth: number; final_url: string } }> | null>(null);
  const [assetsByType, setAssetsByType] = useState<Record<string, IrAsset[]>>({});

  useEffect(() => {
    setSourceId(null);
    setUrl("");
    setSuggestNote(null);
    setSuggestCandidates(null);
  }, [tk]);

  useEffect(() => {
    if (!tk || !prefsReady) return;
    const last = irRowForTicker?.lastSourceId ?? null;
    if (last?.trim()) setSourceId(last);
  }, [tk, prefsReady, irIndexer, irRowForTicker?.lastSourceId]);

  // Per ticker: auto-suggest IR main page URL (stored in account preferences).
  useEffect(() => {
    if (!tk) return;
    if (!prefsReady) return;
    const cached = (irRowForTicker?.suggestedIrUrl ?? "").trim();
    if (cached) {
      setUrl((prev) => (prev.trim().length === 0 ? cached : prev));
      return;
    }
    let cancelled = false;
    (async () => {
      setSuggestLoading(true);
      setSuggestNote(null);
      setSuggestCandidates(null);
      try {
        const res = await fetch(`/api/ir/find?ticker=${encodeURIComponent(tk)}`, { method: "GET" });
        const json = (await res.json()) as {
          ok?: boolean;
          url?: string;
          confidence?: string;
          notes?: string;
          candidates?: IrUrlCandidate[];
          error?: string;
        };
        if (!res.ok || !json.ok) throw new Error(json.error || "IR search failed");
        const found = (json.url ?? "").trim();
        if (!found) throw new Error("IR search did not return a URL");
        if (cancelled) return;
        updatePreferences((p) => ({
          ...p,
          irIndexer: {
            ...(p.irIndexer ?? {}),
            [tk]: {
              ...(p.irIndexer?.[tk] ?? {}),
              suggestedIrUrl: found,
              suggestedIrMeta: JSON.stringify({
                at: new Date().toISOString(),
                confidence: json.confidence,
                notes: json.notes,
              }),
            },
          },
        }));
        setSuggestCandidates(Array.isArray(json.candidates) && json.candidates.length ? json.candidates : null);
        setUrl((prev) => (prev.trim().length === 0 ? found : prev));
        setSuggestNote(
          `Suggested IR page found${json.confidence ? ` (${json.confidence})` : ""}. Review then click “Index page”.`
        );
      } catch (e) {
        if (!cancelled) {
          setSuggestNote(e instanceof Error ? e.message : "IR search failed");
        }
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, prefsReady, irIndexer, irRowForTicker?.suggestedIrUrl, updatePreferences]);

  const loadSource = useCallback(async (id: string) => {
    if (!tk || !id) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ir/source/${encodeURIComponent(id)}?ticker=${encodeURIComponent(tk)}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      const json = (await res.json()) as SourcePayload & { error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load source");
      setPayload(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load source");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }, [tk]);

  useEffect(() => {
    if (!sourceId) return;
    void loadSource(sourceId);
  }, [sourceId, loadSource]);

  const startIndex = useCallback(async () => {
    if (!tk) return;
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Please paste an IR page URL.");
      return;
    }
    setLoading(true);
    setError(null);
    setSections(null);
    setAssetsByType({});
    try {
      const res = await fetch("/api/ir/index", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: tk, url: trimmed }),
      });
      const json = (await res.json()) as { ok?: boolean; sourceId?: string; jobId?: string; error?: string };
      if (!res.ok) throw new Error(json.error || "Index request failed");
      if (!json.sourceId) throw new Error("Index request did not return sourceId");
      setSourceId(json.sourceId);
      updatePreferences((p) => ({
        ...p,
        irIndexer: {
          ...(p.irIndexer ?? {}),
          [tk]: {
            ...(p.irIndexer?.[tk] ?? {}),
            lastSourceId: json.sourceId,
          },
        },
      }));
      await loadSource(json.sourceId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Indexing failed");
    } finally {
      setLoading(false);
    }
  }, [tk, url, loadSource, updatePreferences]);

  const refresh = useCallback(async () => {
    if (!sourceId) return;
    await loadSource(sourceId);
  }, [sourceId, loadSource]);

  const loadSections = useCallback(async () => {
    if (!sourceId || !tk) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ir/source/${encodeURIComponent(sourceId)}/sections?ticker=${encodeURIComponent(tk)}`);
      const json = (await res.json()) as { sections?: any[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load sections");
      setSections((json.sections ?? []) as any);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load sections");
    } finally {
      setLoading(false);
    }
  }, [sourceId, tk]);

  const loadAssets = useCallback(async (type?: IrAssetType) => {
    if (!sourceId || !tk) return;
    const key = type ?? "all";
    if (assetsByType[key]) return;
    setLoading(true);
    setError(null);
    try {
      const qp = type ? `&type=${encodeURIComponent(type)}` : "";
      const res = await fetch(`/api/ir/source/${encodeURIComponent(sourceId)}/assets?ticker=${encodeURIComponent(tk)}${qp}`);
      const json = (await res.json()) as { assets?: IrAsset[]; error?: string };
      if (!res.ok) throw new Error(json.error || "Failed to load assets");
      setAssetsByType((prev) => ({ ...prev, [key]: json.assets ?? [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load assets");
    } finally {
      setLoading(false);
    }
  }, [sourceId, tk, assetsByType]);

  useEffect(() => {
    if (!sourceId) return;
    if (activeTab === "Page Sections" && !sections) void loadSections();
    if (activeTab === "PDFs") void loadAssets("pdf");
    if (activeTab === "SEC Filings") void loadAssets("sec_filing");
    if (activeTab === "Other Links") void loadAssets();
  }, [activeTab, sourceId, sections, loadSections, loadAssets]);

  const summaryCards = useMemo(() => {
    const byType = payload?.summary?.assetsByType;
    if (!byType) return [];
    const order: IrAssetType[] = ["pdf", "sec_filing", "presentation", "transcript", "webcast", "press_release", "governance", "event", "html_page", "other", "annual_report", "quarterly_report"];
    const out = order
      .filter((t) => (byType[t] ?? 0) > 0)
      .map((t) => ({ type: t, count: byType[t] ?? 0 }));
    return out;
  }, [payload]);

  const job = payload?.latestJob ?? null;
  const status = job?.status ?? payload?.source.status ?? null;

  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "var(--border2)", background: "var(--card)" }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
            IR page URL
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            className="w-full rounded-md border bg-[var(--card)] px-3 py-2 text-sm"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            placeholder="https://example.com/investor-relations"
          />
          {suggestCandidates && suggestCandidates.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                Candidates
              </div>
              <select
                className="min-w-[18rem] max-w-full rounded-md border bg-[var(--card)] px-2 py-1.5 text-xs"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              >
                {suggestCandidates.map((c) => (
                  <option key={c.url} value={c.url}>
                    {c.url}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {suggestLoading || suggestNote ? (
            <div className="mt-1 text-[11px]" style={{ color: suggestLoading ? "var(--muted)" : "var(--muted2)" }}>
              {suggestLoading ? "Searching for IR main page…" : suggestNote}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={startIndex}
            disabled={loading || !tk}
            className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            Index page
          </button>
          <button
            type="button"
            onClick={refresh}
            disabled={loading || !sourceId}
            className="rounded border px-4 py-2 text-sm font-medium disabled:opacity-60"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <div className="mt-3 rounded border border-dashed p-2 text-xs" style={{ borderColor: "var(--warn)", color: "var(--warn)" }}>
          {error}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted2)" }}>
        <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
          Status: {status ?? "—"}
        </span>
        {job?.pages_scanned != null ? (
          <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
            Pages: {job.pages_scanned}
          </span>
        ) : null}
        {job?.assets_found != null ? (
          <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
            Assets: {job.assets_found}
          </span>
        ) : null}
        {payload?.source.cik ? (
          <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
            CIK: {payload.source.cik}
          </span>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className="rounded border px-3 py-2 text-xs font-semibold"
            style={{
              borderColor: activeTab === t ? "var(--accent)" : "var(--border2)",
              color: activeTab === t ? "var(--accent)" : "var(--text)",
              background: activeTab === t ? "rgba(0,212,170,0.08)" : "transparent",
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {activeTab === "Indexer Overview" ? (
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
            <div className="font-semibold" style={{ color: "var(--text)" }}>Source</div>
            <div className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
              <div>Root: {payload?.source.root_url ?? "—"}</div>
              <div>Company: {payload?.source.company_name ?? "—"}</div>
              <div>Last indexed: {payload?.source.last_indexed_at ?? "—"}</div>
            </div>
          </div>

          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
            <div className="font-semibold" style={{ color: "var(--text)" }}>Totals</div>
            <div className="mt-2 space-y-1" style={{ color: "var(--muted2)" }}>
              <div>Pages indexed: {payload?.summary?.pagesIndexed ?? "—"}</div>
              <div>Assets found: {payload?.summary?.assetsFound ?? "—"}</div>
            </div>
          </div>

          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--border2)", background: "var(--sb)" }}>
            <div className="font-semibold" style={{ color: "var(--text)" }}>Assets by type</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {summaryCards.length === 0 ? (
                <span style={{ color: "var(--muted2)" }}>—</span>
              ) : summaryCards.map((c) => (
                <span key={c.type} className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
                  {labelType(c.type)}: {c.count}
                </span>
              ))}
            </div>
          </div>

          <div className="lg:col-span-3 rounded border border-dashed p-3 text-xs" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
            This feature indexes visible IR page structure and discoverable links/metadata. Full access to some resources may require entitlements or logins; the app does not bypass paywalls.
          </div>
        </div>
      ) : null}

      {activeTab === "Page Sections" ? (
        <div className="mt-4 space-y-3">
          {!sections ? (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>Loading sections…</p>
          ) : sections.length === 0 ? (
            <p className="text-xs" style={{ color: "var(--muted2)" }}>No sections extracted yet.</p>
          ) : (
            <ul className="space-y-2">
              {sections
                .filter((s) => (s.heading ?? "").trim().length > 0 || (s.text_content ?? "").trim().length > 0)
                .slice(0, 200)
                .map((s) => (
                  <li key={s.id} className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
                    <div className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                      {(s.heading ?? "Section").toString()}{" "}
                      <span style={{ color: "var(--muted2)", fontWeight: 500 }}>
                        — depth {s.page.depth}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px]" style={{ color: "var(--muted2)" }}>
                      Page:{" "}
                      <a href={s.page.final_url} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
                        {s.page.final_url}
                      </a>
                    </div>
                    {s.text_content ? (
                      <div className="mt-2 whitespace-pre-wrap text-xs leading-relaxed" style={{ color: "var(--text)" }}>
                        {s.text_content.length > 700 ? `${s.text_content.slice(0, 700)}…` : s.text_content}
                      </div>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </div>
      ) : null}

      {activeTab === "PDFs" ? (
        <AssetList ticker={tk} items={assetsByType["pdf"] ?? null} emptyLabel="No PDFs found yet." />
      ) : null}

      {activeTab === "SEC Filings" ? (
        <AssetList ticker={tk} items={assetsByType["sec_filing"] ?? null} emptyLabel="No SEC filings found yet." />
      ) : null}

      {activeTab === "Other Links" ? (
        <AssetList ticker={tk} items={assetsByType["all"] ?? null} emptyLabel="No assets found yet." />
      ) : null}
    </div>
  );
}

function AssetList({ items, emptyLabel, ticker }: { items: IrAsset[] | null; emptyLabel: string; ticker: string }) {
  if (!items) {
    return (
      <div className="mt-4">
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          Loading…
        </p>
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="mt-4">
        <p className="text-xs" style={{ color: "var(--muted2)" }}>
          {emptyLabel}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-4 space-y-2">
      {items.slice(0, 300).map((a) => (
        <div key={a.id} className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
          <div className="flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--muted2)" }}>
            <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
              {labelType(a.asset_type)}
            </span>
            {a.is_from_sec ? (
              <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
                from SEC
              </span>
            ) : (
              <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
                from IR page
              </span>
            )}
            {a.published_at ? (
              <span className="rounded border px-2 py-1" style={{ borderColor: "var(--border2)" }}>
                {new Date(a.published_at).toLocaleDateString()}
              </span>
            ) : null}
          </div>
          <div className="mt-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
            {a.title || a.anchor_text || a.url}
          </div>
          <div className="mt-1 text-xs" style={{ color: "var(--muted2)" }}>
            {a.hostname}
          </div>
          {a.context_text ? (
            <div className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
              Context: {a.context_text}
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <a
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
            >
              Open link
            </a>
            <SaveFilingLinkButton ticker={ticker} url={a.url} mode="saved-documents" />
          </div>
        </div>
      ))}
    </div>
  );
}

