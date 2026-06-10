"use client";

import { useCallback, useEffect, useState } from "react";
import { roicPeriodToPresentationPeriod } from "@/lib/presentations/discovery/period";

type DiscoveryBest = {
  title: string;
  url: string;
  file_type: string;
};

type DiscoveryResponse = {
  ok: boolean;
  best: DiscoveryBest | null;
  savedDocument: { filename: string; openUrl: string; bytes: number } | null;
  error: string | null;
};

export function ManagementPresentationDiscoveryPanel(props: {
  ticker: string;
  period: string | null;
  reportDate?: string | null;
  enabled: boolean;
  onDiscoverySaveUrlChange?: (info: { url: string | null; alreadySaved: boolean }) => void;
}) {
  const { ticker, period, reportDate, enabled, onDiscoverySaveUrlChange } = props;
  const displayPeriod = roicPeriodToPresentationPeriod(period) ?? period;

  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const fetchDiscovery = useCallback(async () => {
    if (!enabled || !displayPeriod) return;
    setLoading(true);
    setNotFound(false);
    try {
      const qs = new URLSearchParams({
        period: displayPeriod,
        save: "1",
      });
      if (reportDate?.trim()) qs.set("reportDate", reportDate.trim().slice(0, 10));
      const res = await fetch(`/api/presentations/discover/${encodeURIComponent(ticker)}?${qs.toString()}`);
      const json = (await res.json()) as DiscoveryResponse & { error?: string };
      if (!res.ok || !json.best) {
        setData(null);
        setNotFound(true);
        return;
      }
      setData(json);
      if (!json.ok && !json.best) setNotFound(true);
    } catch {
      setData(null);
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [displayPeriod, enabled, reportDate, ticker]);

  useEffect(() => {
    if (!enabled || !displayPeriod) {
      setData(null);
      setNotFound(false);
      return;
    }
    void fetchDiscovery();
  }, [displayPeriod, enabled, fetchDiscovery, refreshKey]);

  useEffect(() => {
    if (!onDiscoverySaveUrlChange) return;
    const best = data?.best;
    if (!best?.url?.trim()) {
      onDiscoverySaveUrlChange({ url: null, alreadySaved: false });
      return;
    }
    onDiscoverySaveUrlChange({
      url: best.url.trim(),
      alreadySaved: Boolean(data?.savedDocument?.openUrl),
    });
  }, [data, onDiscoverySaveUrlChange]);

  if (!enabled) return null;

  if (!displayPeriod) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Couldn&apos;t find a management presentation for this period.
      </p>
    );
  }

  if (loading) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Searching…
      </p>
    );
  }

  const best = data?.best;
  if (!best) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Couldn&apos;t find a management presentation for this period.
        {notFound ? (
          <>
            {" "}
            <button
              type="button"
              className="underline underline-offset-2"
              style={{ color: "var(--muted)" }}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              Retry
            </button>
          </>
        ) : null}
      </p>
    );
  }

  const embedUrl = data?.savedDocument?.openUrl ?? (best.file_type === "pdf" ? best.url : null);

  if (embedUrl && best.file_type === "pdf") {
    return (
      <iframe
        title={`${ticker} ${displayPeriod} management presentation`}
        src={embedUrl}
        className="h-[min(82vh,calc(100dvh-11rem))] w-full rounded border"
        style={{ borderColor: "var(--border)" }}
      />
    );
  }

  return (
    <p className="text-sm" style={{ color: "var(--muted2)" }}>
      <a
        href={best.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-[var(--accent)] underline underline-offset-2"
      >
        Open presentation
      </a>
    </p>
  );
}
