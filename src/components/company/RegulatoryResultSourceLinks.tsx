"use client";

import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import type { RegulatorySearchResult } from "@/lib/regulatory/types";

/**
 * Detail / document / download links for a regulatory search row, each with Save → Saved Documents (PDF/HTML).
 * Uses `saved-documents` mode so agency hosts outside the SEC/FCC/USPTO filings allowlist still save.
 */
export function RegulatoryResultSourceLinks({ ticker, row }: { ticker: string; row: RegulatorySearchResult }) {
  const d = row.detail_url?.trim();
  const doc = row.document_url?.trim();
  const dl = row.download_url?.trim();

  const pairs: { label: string; url: string }[] = [];
  if (d) pairs.push({ label: "Open", url: d });
  if (doc && doc !== d) pairs.push({ label: "Document", url: doc });
  if (dl && dl !== d && dl !== doc) pairs.push({ label: "Download", url: dl });

  if (pairs.length === 0) {
    return <span style={{ color: "var(--muted2)" }}>—</span>;
  }

  return (
    <div className="flex flex-col gap-1">
      {pairs.map((p, i) => (
        <span key={`${p.url}-${i}`} className="inline-flex flex-wrap items-center gap-x-0.5 align-middle">
          <a href={p.url} target="_blank" rel="noreferrer" className="text-xs font-medium underline" style={{ color: "var(--accent)" }}>
            {p.label}
          </a>
          <SaveFilingLinkButton ticker={ticker} url={p.url} mode="saved-documents" />
        </span>
      ))}
    </div>
  );
}
