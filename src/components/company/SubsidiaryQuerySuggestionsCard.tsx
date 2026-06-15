"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { subsidiaryChipNamesFromSavedProfile } from "@/lib/publicRecordsSubsidiaryRows";

type PublicRecordsProfileResp = {
  profile: {
    companyName?: string | null;
    subsidiaryNames?: string[];
    subsidiaryDomiciles?: string[];
    subsidiaryExhibit21Snapshot?: unknown;
    updatedAt?: string;
  };
};

type QueryNameHints =
  | { ok: true; names: string[]; sources: string[]; disclaimer: string }
  | { ok: false; message: string };

const DEFAULT_DISCLAIMER =
  "Subsidiaries from your saved Public Records profile: the Exhibit 21 grid when you have one, otherwise the name + domicile table (Overview → Public Records Profile). Verify matches.";

function ellipsize(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function buildNamesFromPublicRecordsProfile(p: PublicRecordsProfileResp["profile"]): string[] {
  return subsidiaryChipNamesFromSavedProfile(p.subsidiaryExhibit21Snapshot, p.subsidiaryNames, p.subsidiaryDomiciles);
}

export function SubsidiaryQuerySuggestionsCard({
  ticker,
  companyName,
  disabled = false,
  disclaimer = DEFAULT_DISCLAIMER,
  searchCollapseSignal = 0,
  onPickName,
  onNamesLoaded,
}: {
  ticker: string;
  companyName?: string;
  disabled?: boolean;
  disclaimer?: string;
  /** Increment from parent when a search starts to slide the panel up. */
  searchCollapseSignal?: number;
  onPickName: (name: string) => void;
  onNamesLoaded?: (names: string[]) => void;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [hintsLoading, setHintsLoading] = useState(false);
  const [hintsMessage, setHintsMessage] = useState<string | null>(null);
  const [hintsPayload, setHintsPayload] = useState<Extract<QueryNameHints, { ok: true }> | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCollapsed(false);
  }, [safeTicker]);

  useEffect(() => {
    if (searchCollapseSignal > 0) setCollapsed(true);
  }, [searchCollapseSignal]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setHintsLoading(true);
    setHintsMessage(null);
    setHintsPayload(null);
    const u = `/api/companies/${encodeURIComponent(safeTicker)}/public-records/profile`;
    fetch(u, { credentials: "same-origin", cache: "no-store" })
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 401) {
          setHintsPayload(null);
          setHintsMessage("Sign in to load subsidiaries from your Public Records profile.");
          onNamesLoaded?.([]);
          return;
        }
        if (!res.ok) {
          setHintsPayload(null);
          setHintsMessage("Could not load Public Records profile for this ticker.");
          onNamesLoaded?.([]);
          return;
        }
        const body = (await res.json()) as PublicRecordsProfileResp;
        const p = body.profile;
        const names = buildNamesFromPublicRecordsProfile(p);
        const sources = [
          `Public Records Profile — subsidiary names (${names.length})`,
          p.updatedAt ? `Profile updated ${typeof p.updatedAt === "string" ? p.updatedAt.slice(0, 10) : ""}` : "",
        ].filter(Boolean);
        if (names.length === 0) {
          setHintsPayload(null);
          setHintsMessage(
            "No subsidiaries we could derive from your Public Records profile yet. Ensure the Exhibit 21 grid has entity names visible, or add rows under the subsidiary name/domicile table (Overview → Public Records Profile), or ingest from SEC there.",
          );
          onNamesLoaded?.([]);
          return;
        }
        setHintsPayload({ ok: true, names, sources, disclaimer });
        onNamesLoaded?.(names);
        setHintsMessage(null);
      })
      .catch(() => {
        if (!cancelled) {
          setHintsPayload(null);
          setHintsMessage("Could not load Public Records profile.");
          onNamesLoaded?.([]);
        }
      })
      .finally(() => {
        if (!cancelled) setHintsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker, disclaimer, onNamesLoaded]);

  if (!safeTicker) return null;

  const hasNames = Boolean(hintsPayload?.names.length);

  return (
    <div className="tab-slide-up-root">
      {hasNames ? (
        <div className="tab-slide-up-restore">
          <span className="tab-slide-up-restore-label">Names to try ({hintsPayload!.names.length})</span>
          <span className="tab-slide-up-restore-actions">
            <button
              type="button"
              className="tab-slide-up-restore-btn"
              disabled={!collapsed}
              onClick={() => setCollapsed(false)}
            >
              Show
            </button>
            <button
              type="button"
              className="tab-slide-up-restore-btn"
              disabled={collapsed}
              onClick={() => setCollapsed(true)}
            >
              Hide
            </button>
          </span>
        </div>
      ) : null}
      <div className={`tab-slide-up-panel${collapsed ? " tab-slide-up-panel--collapsed" : ""}`}>
        <div className="tab-slide-up-panel-inner">
          <Card title="Search query">
      {hintsLoading && (
        <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
          Loading subsidiaries from your Public Records profile…
        </p>
      )}
      {hintsMessage && !hintsLoading && (
        <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
          {hintsMessage}{" "}
          <span style={{ color: "var(--muted2)" }}>(Tip: Overview → Public Records Profile, or ingest 10-K / Exhibit 21 there.)</span>
        </p>
      )}
      {hintsPayload && hintsPayload.names.length > 0 && (
        <div className="mb-3 rounded border border-[var(--border)] bg-[var(--card2)]/30 px-2.5 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Names to try in the query box ({hintsPayload.names.length})
          </div>
          <div
            className="mt-1.5 max-h-24 overflow-y-auto rounded border border-[var(--border)] bg-[var(--card)]/40 p-1.5"
            style={{ scrollbarGutter: "stable" }}
          >
            <div className="flex flex-wrap gap-1">
              {hintsPayload.names.map((n, idx) => (
                <button
                  key={`${n}-${idx}`}
                  type="button"
                  title={n}
                  disabled={disabled}
                  onClick={() => {
                    setCollapsed(true);
                    onPickName(n);
                  }}
                  className="max-w-full rounded border border-[var(--border)] bg-[var(--card)] px-1.5 py-px text-left text-[10px] leading-snug transition hover:bg-[var(--card2)] disabled:opacity-50"
                  style={{ color: "var(--text)" }}
                >
                  {ellipsize(n, 36)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
          </Card>
        </div>
      </div>
    </div>
  );
}

