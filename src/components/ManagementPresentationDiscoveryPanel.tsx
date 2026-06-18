"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { roicPeriodToPresentationPeriod } from "@/lib/presentations/discovery/period";
import {
  getPeriodFinancialsPeriodCache,
  patchPeriodFinancialsPeriodCache,
  periodFinancialsCacheKey,
} from "@/lib/period-financials-period-cache";

type DiscoveryBest = {
  title: string;
  url: string;
  file_type: string;
};

export type DiscoveryResponse = {
  ok: boolean;
  best: DiscoveryBest | null;
  savedDocument: { filename: string; openUrl: string; bytes: number } | null;
  error: string | null;
};

export type ManagementPresentationDiscoveryState = {
  displayPeriod: string | null;
  loading: boolean;
  notFound: boolean;
  data: DiscoveryResponse | null;
  retry: () => void;
};

export function useManagementPresentationDiscovery({
  ticker,
  period,
  reportDate,
  enabled,
  cacheAccession,
  onDiscoverySaveUrlChange,
}: {
  ticker: string;
  period: string | null;
  reportDate?: string | null;
  enabled: boolean;
  /** When set, discovery results are cached per ticker + accession for instant revisit. */
  cacheAccession?: string | null;
  onDiscoverySaveUrlChange?: (info: { url: string | null; alreadySaved: boolean }) => void;
}): ManagementPresentationDiscoveryState {
  const displayPeriod = roicPeriodToPresentationPeriod(period) ?? period;

  const [loading, setLoading] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<DiscoveryResponse | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  const retry = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (!enabled || !displayPeriod || !ticker.trim()) {
      abortRef.current?.abort();
      abortRef.current = null;
      setLoading(false);
      setData(null);
      setNotFound(false);
      return;
    }

    const abort = new AbortController();
    abortRef.current?.abort();
    abortRef.current = abort;

    setLoading(true);
    setNotFound(false);

    const cacheKey =
      cacheAccession?.trim() && ticker.trim()
        ? periodFinancialsCacheKey(ticker, cacheAccession)
        : null;
    if (refreshKey === 0 && cacheKey) {
      const cached = getPeriodFinancialsPeriodCache(cacheKey)?.mgmtDiscovery;
      if (cached) {
        setData(cached.data);
        setNotFound(cached.notFound);
        setLoading(false);
        return;
      }
    }

    void (async () => {
      try {
        const qs = new URLSearchParams({
          period: displayPeriod,
          save: "1",
        });
        if (reportDate?.trim()) qs.set("reportDate", reportDate.trim().slice(0, 10));
        const res = await fetch(`/api/presentations/discover/${encodeURIComponent(ticker)}?${qs.toString()}`, {
          signal: abort.signal,
        });
        const json = (await res.json()) as DiscoveryResponse & { error?: string };
        if (abort.signal.aborted) return;
        if (!res.ok || !json.best) {
          setData(null);
          setNotFound(true);
          if (cacheKey) {
            patchPeriodFinancialsPeriodCache(ticker, cacheAccession!, {
              mgmtDiscovery: { data: null, notFound: true },
            });
          }
          return;
        }
        setData(json);
        if (!json.ok && !json.best) setNotFound(true);
        if (cacheKey) {
          patchPeriodFinancialsPeriodCache(ticker, cacheAccession!, {
            mgmtDiscovery: {
              data: json,
              notFound: !json.ok && !json.best,
            },
          });
        }
      } catch (e) {
        if (abort.signal.aborted) return;
        setData(null);
        setNotFound(true);
        if (cacheKey) {
          patchPeriodFinancialsPeriodCache(ticker, cacheAccession!, {
            mgmtDiscovery: { data: null, notFound: true },
          });
        }
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();

    return () => {
      abort.abort();
      if (abortRef.current === abort) abortRef.current = null;
    };
  }, [cacheAccession, displayPeriod, enabled, refreshKey, reportDate, ticker]);

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

  return {
    displayPeriod,
    loading,
    notFound,
    data,
    retry,
  };
}

export function ManagementPresentationDiscoveryPanel({
  ticker,
  discovery,
}: {
  ticker: string;
  discovery: ManagementPresentationDiscoveryState;
}) {
  const { displayPeriod, loading, notFound, data, retry } = discovery;

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
              onClick={retry}
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
