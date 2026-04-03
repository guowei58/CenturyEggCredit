"use client";

import type { BrokerAccessLevel, BrokerReportType, BrokerResearchResult } from "@/lib/brokerResearch/types";

const TYPE_LABELS: Record<BrokerReportType, string> = {
  initiation: "Initiation",
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  rating_change: "Rating change",
  target_price_change: "Target / PT",
  earnings_preview: "Earnings preview",
  earnings_recap: "Earnings recap",
  company_update: "Company update",
  sector_note: "Sector",
  thematic_note: "Thematic",
  research_portal: "Portal",
  public_insight: "Insight",
  research_landing_page: "Landing",
  unknown: "Unknown",
};

const ACCESS_LABELS: Record<BrokerAccessLevel, string> = {
  public: "Likely public",
  login_required: "Login / portal",
  subscription_likely: "Subscription likely",
  unknown: "Access unclear",
};

export function BrokerResearchCard({ item }: { item: BrokerResearchResult }) {
  let host = "";
  try {
    host = new URL(item.url).hostname;
  } catch {
    host = item.rawSourceDomain || "";
  }

  const when = item.publishedAt
    ? new Date(item.publishedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

  return (
    <article
      className="flex flex-col gap-3 rounded-lg border p-4"
      style={{ borderColor: "var(--border)", background: "var(--card)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {item.brokerName}
        </span>
        <span
          className="rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ borderColor: "var(--border2)", color: "var(--text)" }}
        >
          {TYPE_LABELS[item.reportType]}
        </span>
        <span
          className="rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
          style={{ borderColor: "var(--warn)", color: "var(--warn)" }}
        >
          {ACCESS_LABELS[item.accessLevel]}
        </span>
        <span className="text-[10px]" style={{ color: "var(--muted)" }}>
          via {item.searchProvider}
        </span>
      </div>
      <h3 className="text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
        {item.title}
      </h3>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px]" style={{ color: "var(--muted)" }}>
        <span className="font-mono">{host}</span>
        <span>{when}</span>
      </div>
      {item.snippet ? (
        <p className="text-[13px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {item.snippet}
        </p>
      ) : null}
      {(item.matchedTickers.length > 0 || item.matchedCompanies.length > 0) && (
        <div className="flex flex-wrap gap-2 text-[10px]" style={{ color: "var(--muted2)" }}>
          {item.matchedTickers.map((t) => (
            <span key={t} className="rounded bg-[var(--sb)] px-2 py-0.5 font-mono" style={{ color: "var(--accent)" }}>
              {t}
            </span>
          ))}
          {item.matchedCompanies.map((c) => (
            <span key={c} className="rounded px-2 py-0.5" style={{ background: "var(--sb)" }}>
              {c}
            </span>
          ))}
        </div>
      )}
      {item.supportingSignals.length > 0 && (
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>
          Signals: {item.supportingSignals.join(", ")}
        </p>
      )}
      <div>
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "rgba(0,212,170,0.08)" }}
        >
          Open link
        </a>
      </div>
    </article>
  );
}
