"use client";

import type { AccessLevel, NormalizedRatingsLink, RatingsAgency, RatingsResultType } from "@/lib/ratings-link-search/types";

const AGENCY_STYLES: Record<RatingsAgency, string> = {
  Fitch: "bg-amber-900/30 text-amber-200 border-amber-700/50",
  "Moody's": "bg-blue-900/30 text-blue-200 border-blue-700/50",
  "S&P": "bg-slate-700/50 text-slate-100 border-slate-500/40",
};

const TYPE_LABEL: Record<RatingsResultType, string> = {
  issuer_rating: "Issuer",
  issue_rating: "Notes / issues",
  rating_action: "Rating action",
  research: "Research",
  commentary: "Commentary",
  unknown: "Unknown",
};

function accessNote(level: AccessLevel): string {
  switch (level) {
    case "login_required":
      return "May require agency login.";
    case "subscription_likely":
      return "May require subscription or institutional access.";
    case "public":
      return "Page may be publicly viewable.";
    default:
      return "Access may require a free account, subscription, or institutional entitlement.";
  }
}

export function RatingsResearchLinkCard({ item }: { item: NormalizedRatingsLink }) {
  let host = item.sourceDomain;
  try {
    host = new URL(item.url).hostname;
  } catch {
    /* keep */
  }

  return (
    <article
      className="rounded-lg border p-4 transition-colors"
      style={{ background: "var(--card)", borderColor: "var(--border)" }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${AGENCY_STYLES[item.agency]}`}
        >
          {item.agency}
        </span>
        <span
          className="rounded border px-2 py-0.5 text-[10px] font-medium"
          style={{
            borderColor: "var(--border2)",
            color: "var(--muted2)",
            background: "var(--sb)",
          }}
        >
          {TYPE_LABEL[item.resultType]}
        </span>
        {item.companyMatchScore > 0 && (
          <span className="text-[10px]" style={{ color: "var(--muted)" }}>
            Match score: {item.companyMatchScore}
          </span>
        )}
      </div>
      <h3 className="mt-2 text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>
        {item.title}
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed" style={{ color: "var(--muted2)" }}>
        {item.snippet || "—"}
      </p>
      <div className="mt-2 font-mono text-[11px]" style={{ color: "var(--accent)" }}>
        {host}
      </div>
      {item.publishedDate && (
        <div className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
          Published: {item.publishedDate}
        </div>
      )}
      {item.instrumentHints.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.instrumentHints.map((h) => (
            <span
              key={h}
              className="rounded px-2 py-0.5 text-[10px]"
              style={{ background: "var(--panel)", color: "var(--muted2)" }}
            >
              {h}
            </span>
          ))}
        </div>
      )}
      <p className="mt-3 text-[11px] leading-snug italic" style={{ color: "var(--warn)" }}>
        {accessNote(item.accessLevel)}
      </p>
      <div className="mt-3">
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex rounded-md border px-3 py-2 text-xs font-semibold transition-colors"
          style={{
            borderColor: "var(--accent)",
            color: "var(--accent)",
            background: "rgba(0, 212, 170, 0.08)",
          }}
        >
          Open official page
        </a>
      </div>
    </article>
  );
}
