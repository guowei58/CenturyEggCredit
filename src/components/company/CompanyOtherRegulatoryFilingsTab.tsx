"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, TabBar } from "@/components/ui";
import { REGULATORY_SOURCE_REGISTRY } from "@/lib/regulatory/registry";
import type { RegulatorySourceRegistryEntry } from "@/lib/regulatory/types";
import { CONNECTION_BUCKET_LABEL, connectionBucketForSource } from "@/lib/regulatory/connectionBuckets";
import { accessGuideForSource } from "@/lib/regulatory/regulatoryAccessGuides";
import { RegulatorySearchNotes } from "@/components/company/RegulatorySearchNotes";

const DEDICATED_REGULATORY_TAB_SOURCE_IDS = new Set([
  "epa_echo",
  "epa_envirofacts",
  "fda_openfda",
  "cfpb_complaints",
  "fdic_bankfind",
  "occ_institution_data",
  "ffiec_cdr",
  "cms_data",
  "osha",
  "ofac",
  "phmsa",
  "ferc",
  "usaspending",
  "federal_register",
  "regulations_gov",
  "ecfr",
  "eia",
  "sam_gov",
  "fec",
]);
function badgeColor(access: string) {
  if (access === "api") return { bg: "rgba(0,212,170,0.14)", fg: "var(--accent)", border: "rgba(0,212,170,0.4)" };
  if (access === "bulk_data") return { bg: "rgba(59,130,246,0.14)", fg: "#93c5fd", border: "rgba(59,130,246,0.35)" };
  if (access === "search_portal") return { bg: "rgba(234,179,8,0.14)", fg: "#fde68a", border: "rgba(234,179,8,0.35)" };
  return { bg: "rgba(148,163,184,0.14)", fg: "var(--muted2)", border: "rgba(148,163,184,0.35)" };
}

function bucketBadge(bucket: string) {
  if (bucket === "live_api") return { bg: "rgba(34,197,94,0.12)", fg: "#86efac", border: "rgba(34,197,94,0.35)" };
  if (bucket === "official_api_needs_key") return { bg: "rgba(168,85,247,0.12)", fg: "#e9d5ff", border: "rgba(168,85,247,0.35)" };
  if (bucket === "bulk_download") return { bg: "rgba(59,130,246,0.14)", fg: "#93c5fd", border: "rgba(59,130,246,0.35)" };
  return { bg: "rgba(148,163,184,0.14)", fg: "var(--muted2)", border: "rgba(148,163,184,0.35)" };
}

function sectionTitle(label: string) {
  return (
    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ color: "var(--muted)" }}>
      {label}
    </div>
  );
}

function fallbackAccessRequirements(source: RegulatorySourceRegistryEntry): string[] {
  const out: string[] = [];
  if (source.requires_api_key && source.env_key_name) {
    out.push(`Programmatic access may require ${source.env_key_name} if you want to automate this source later.`);
  } else {
    out.push("Public website access is available without an API key for manual review.");
  }
  if (source.access_type === "bulk_data") {
    out.push("Users should expect downloadable ZIP/CSV/XLSX files and may need Excel or another offline analysis tool.");
  }
  if (source.access_type === "search_portal" || source.access_type === "manual") {
    out.push("Users usually need to search by legal entity name, affiliate, docket, identifier, or keyword on the site itself.");
  }
  return out;
}

function fallbackWhatsInside(source: RegulatorySourceRegistryEntry): string[] {
  return [
    source.category,
    source.notes || `Use ${source.display_name} for source-specific records relevant to company diligence.`,
  ];
}

export function CompanyOtherRegulatoryFilingsTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const sources = useMemo(
    () =>
      REGULATORY_SOURCE_REGISTRY.filter((s) => {
        if (DEDICATED_REGULATORY_TAB_SOURCE_IDS.has(s.source_id)) return false;
        const bucket = connectionBucketForSource(s.source_id);
        return bucket === "bulk_download" || bucket === "portal_manual";
      }),
    []
  );
  const [activeSourceId, setActiveSourceId] = useState(sources[0]?.source_id ?? "nhtsa");

  useEffect(() => {
    if (sources.some((s) => s.source_id === activeSourceId)) return;
    const next = sources[0]?.source_id;
    if (next) setActiveSourceId(next);
  }, [sources, activeSourceId]);

  const activeSource = useMemo(
    () => sources.find((s) => s.source_id === activeSourceId) ?? sources[0],
    [sources, activeSourceId],
  );

  const searchSeed = (companyName ?? "").trim() || safeTicker;

  const searchNotes = useMemo(() => {
    if (!activeSource || !safeTicker) return [];
    const connBucket = connectionBucketForSource(activeSource.source_id);
    const guide = accessGuideForSource(activeSource.source_id);
    const accessRequirements = guide?.accessRequirements?.length
      ? guide.accessRequirements
      : fallbackAccessRequirements(activeSource);
    const whatsInside = guide?.whatsInside?.length ? guide.whatsInside : fallbackWhatsInside(activeSource);
    const notes: string[] = [
      `Suggested search seed: ${searchSeed} (plus subsidiaries, legal names, docket numbers, and known identifiers).`,
      `This source is accessed manually on ${activeSource.display_name} (${CONNECTION_BUCKET_LABEL[connBucket].toLowerCase()}).`,
    ];
    if (activeSource.notes?.trim()) notes.push(activeSource.notes.trim());
    notes.push(...accessRequirements);
    notes.push(...whatsInside.map((item) => `Data available: ${item}`));
    return notes;
  }, [activeSource, searchSeed, safeTicker]);

  if (!safeTicker) {
    return (
      <Card title="Other Regulatory Filings - Manual">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to search regulatory sources.
        </p>
      </Card>
    );
  }

  const access = activeSource?.access_type ?? "manual";
  const b = badgeColor(access);
  const connBucket = activeSource ? connectionBucketForSource(activeSource.source_id) : "portal_manual";
  const bb = bucketBadge(connBucket);
  const sourceTabs = sources.map((s) => ({ id: s.source_id, label: s.display_name }));
  const guide = activeSource ? accessGuideForSource(activeSource.source_id) : null;
  const accessRequirements = guide?.accessRequirements?.length ? guide.accessRequirements : activeSource ? fallbackAccessRequirements(activeSource) : [];
  const whatsInside = guide?.whatsInside?.length ? guide.whatsInside : activeSource ? fallbackWhatsInside(activeSource) : [];

  return (
    <div className="space-y-6">
      <Card title={`Other Regulatory Filings - Manual — ${safeTicker}`}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
                {activeSource?.agency} — {activeSource?.display_name}
              </div>
              <span
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider"
                style={{ background: b.bg, color: b.fg, borderColor: b.border }}
              >
                {access.replace("_", " ")}
              </span>
              <span
                className="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold tracking-wide"
                style={{ background: bb.bg, color: bb.fg, borderColor: bb.border }}
                title="How this source is reached (API vs bulk vs portal)"
              >
                {CONNECTION_BUCKET_LABEL[connBucket]}
              </span>
              <span className="text-[11px]" style={{ color: "var(--muted2)" }}>
                {activeSource?.category}
              </span>
            </div>
            {activeSource?.notes ? (
              <p className="mt-1 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
                {activeSource.notes}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {activeSource?.api_docs_url ? (
              <a className="underline text-xs" style={{ color: "var(--accent)" }} href={activeSource.api_docs_url} target="_blank" rel="noreferrer">
                Docs / help
              </a>
            ) : null}
            {activeSource?.base_url ? (
              <a className="underline text-xs" style={{ color: "var(--accent)" }} href={activeSource.base_url} target="_blank" rel="noreferrer">
                Open filing website
              </a>
            ) : null}
          </div>
        </div>

        <RegulatorySearchNotes notes={searchNotes} />

        <div className="mt-4 space-y-3">
          <div>
            {sectionTitle("Agency / source")}
            <TabBar tabs={sourceTabs} activeId={activeSourceId} onSelect={(id) => setActiveSourceId(id)} variant="company" />
          </div>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border p-4" style={{ borderColor: "var(--border2)", background: "var(--card)" }}>
            {sectionTitle("Available links")}
            <div className="flex flex-wrap gap-3 text-sm">
              {activeSource?.base_url ? (
                <a
                  className="rounded-md border px-3 py-2 font-semibold"
                  style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  href={activeSource.base_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open filing website
                </a>
              ) : null}
              {activeSource?.api_docs_url ? (
                <a
                  className="rounded-md border px-3 py-2 font-semibold"
                  style={{ borderColor: "var(--border2)", color: "var(--text)" }}
                  href={activeSource.api_docs_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open docs / access guide
                </a>
              ) : null}
            </div>
            <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
              Suggested search seed: <span className="font-mono">{searchSeed}</span>
              {companyName?.trim() ? <> plus subsidiaries, legacy legal names, DBA names, docket numbers, and known identifiers.</> : <> plus subsidiaries, legal names, and known identifiers.</>}
            </p>
          </div>
          <div className="rounded-lg border p-4" style={{ borderColor: "var(--border2)", background: "var(--card)" }}>
            {sectionTitle("What users need to do to get access")}
            <ul className="space-y-2 text-sm leading-relaxed" style={{ color: "var(--text)" }}>
              {accessRequirements.map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span style={{ color: "var(--muted2)" }}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="mt-5">
          <div className="rounded-lg border p-4" style={{ borderColor: "var(--border2)", background: "var(--card)" }}>
            {sectionTitle("Type of data available")}
            <ul className="space-y-2 text-sm leading-relaxed" style={{ color: "var(--text)" }}>
              {whatsInside.map((item, index) => (
                <li key={index} className="flex gap-2">
                  <span style={{ color: "var(--muted2)" }}>•</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

