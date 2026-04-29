"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, DataTable } from "@/components/ui";
import {
  PUBLIC_RECORD_CATEGORY_DESCRIPTIONS,
  PUBLIC_RECORD_CATEGORY_LABELS,
  PUBLIC_RECORD_CATEGORIES_ORDER,
  REGISTRY_DISCLAIMER,
  TAX_LIEN_DISCLAIMER,
  UCC_DISCLAIMER,
  REAL_ESTATE_DISCLAIMER,
} from "@/lib/publicRecordsConstants";
import { generatePublicRecordsSearchTerms } from "@/lib/generatePublicRecordsSearchTerms";
import type { TenKSource } from "@/lib/sec-10k";
import type { PublicRecordCategory } from "@/generated/prisma/client";

const DISCLAIMER_MAIN =
  "State and local public-record systems vary widely by jurisdiction. Online records may be incomplete, delayed, paywalled, or indexed inconsistently. This workflow is a diligence aid, not a legal opinion. Confirm material findings with the official filing office, legal counsel, a title company, or a public-record vendor.";

type PublicRecordsWorkspaceSectionId = "profile" | "coverage" | "searchTerms" | "findings" | "documents";

/** Workspace panels vs. a selected record category (sidebar). */
type PublicRecordsMainSectionId = PublicRecordsWorkspaceSectionId | "category";

const PUBLIC_RECORDS_WORKSPACE_NAV: { id: PublicRecordsWorkspaceSectionId; label: string }[] = [
  { id: "profile", label: "Public records profile" },
  { id: "coverage", label: "Coverage summary" },
  { id: "searchTerms", label: "Generated search terms" },
  { id: "findings", label: "All findings" },
  { id: "documents", label: "Document upload (PDF)" },
];

type Profile = {
  id: string;
  ticker: string;
  companyName: string | null;
  legalNames: string[];
  formerNames: string[];
  dbaNames: string[];
  subsidiaryNames: string[];
  borrowerNames: string[];
  guarantorNames: string[];
  issuerNames: string[];
  restrictedSubsidiaryNames: string[];
  unrestrictedSubsidiaryNames: string[];
  parentCompanyNames: string[];
  operatingCompanyNames: string[];
  hqState: string | null;
  hqCounty: string | null;
  hqCity: string | null;
  principalExecutiveOfficeAddress: string | null;
  stateOfIncorporation: string | null;
  majorFacilityLocations: unknown;
  knownPropertyLocations: unknown;
  knownPermitJurisdictions: unknown;
  knownRegulatoryJurisdictions: unknown;
  notes: string | null;
};

type PublicRecordRow = {
  id: string;
  category: PublicRecordCategory;
  sourceKey: string | null;
  recordType: string | null;
  status: string;
  searchedEntityName: string | null;
  matchedEntityName: string | null;
  filingDate: string | null;
  amount: string | null;
  jurisdictionState: string | null;
  jurisdictionCounty: string | null;
  recordingNumber: string | null;
  caseNumber: string | null;
  permitNumber: string | null;
  riskLevel: string;
  confidence: string;
  documentUrl: string | null;
  notes: string | null;
};

type ChecklistRow = {
  id: string;
  sourceKey: string;
  category: PublicRecordCategory;
  status: string;
  notes: string | null;
  checkedAt: string | null;
};

type RegistryEntry = {
  id: string;
  category: PublicRecordCategory;
  sourceName: string;
  sourceUrl: string;
  jurisdictionName: string;
  state?: string;
  requiresLogin: boolean;
  hasFees: boolean;
  sourceKey: string;
};

type Recommended = {
  source: RegistryEntry;
  sourceKey: string;
  reason: string;
  priority: string;
  checklist: ChecklistRow | null;
};

function linesToArr(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function RiskBadge({ level }: { level: string }) {
  const c =
    level === "critical" || level === "high"
      ? "var(--danger)"
      : level === "medium"
        ? "var(--warn, #d4a017)"
        : level === "low"
          ? "var(--ok, #2d8a6e)"
          : "var(--muted)";
  return (
    <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: `${c}22`, color: c }}>
      {level}
    </span>
  );
}

function CoverageBadge({ q }: { q: "high" | "medium" | "low" }) {
  const label = q === "high" ? "High coverage" : q === "medium" ? "Medium coverage" : "Low coverage";
  const c = q === "high" ? "var(--ok, #2d8a6e)" : q === "medium" ? "var(--warn, #d4a017)" : "var(--muted)";
  return (
    <span className="rounded px-2 py-0.5 text-[11px] font-semibold" style={{ background: `${c}22`, color: c }}>
      {label}
    </span>
  );
}

export function PublicRecordsTab({ ticker, companyName }: { ticker: string; companyName?: string }) {
  const tk = ticker.trim().toUpperCase();
  const base = `/api/companies/${encodeURIComponent(tk)}/public-records`;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [records, setRecords] = useState<PublicRecordRow[]>([]);
  const [checklist, setChecklist] = useState<ChecklistRow[]>([]);
  const [registry, setRegistry] = useState<RegistryEntry[]>([]);
  const [recommended, setRecommended] = useState<Recommended[]>([]);

  const [activeCategory, setActiveCategory] = useState<PublicRecordCategory>(() => PUBLIC_RECORD_CATEGORIES_ORDER[0]);
  const [profileDraft, setProfileDraft] = useState<Partial<Profile>>({});

  const [modalOpen, setModalOpen] = useState(false);
  const [suggestions, setSuggestions] = useState<Record<string, string>>({});
  const [secBusy, setSecBusy] = useState(false);
  const [secHint, setSecHint] = useState<{ sources: string[]; warnings: string[] } | null>(null);
  const [latestTenK, setLatestTenK] = useState<TenKSource | null>(null);
  const [activeMainSection, setActiveMainSection] = useState<PublicRecordsMainSectionId>("profile");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pRes, rRes, cRes, sRes, tRes] = await Promise.all([
        fetch(`${base}/profile?companyName=${encodeURIComponent(companyName ?? "")}`),
        fetch(`${base}/records`),
        fetch(`${base}/checklist`),
        fetch(`${base}/sources`),
        fetch(`${base}/latest-10k`),
      ]);
      if (!pRes.ok || !rRes.ok || !cRes.ok || !sRes.ok) throw new Error("Failed to load public records data.");
      const pJson = (await pRes.json()) as { profile: Profile };
      const rJson = (await rRes.json()) as { records: PublicRecordRow[] };
      const cJson = (await cRes.json()) as { items: ChecklistRow[] };
      const sJson = (await sRes.json()) as { registry: RegistryEntry[]; recommended: Recommended[] };

      setProfile(pJson.profile);
      setProfileDraft(pJson.profile);
      setRecords(rJson.records);
      setChecklist(cJson.items);
      setRegistry(sJson.registry);
      setRecommended(sJson.recommended);

      if (tRes.ok) {
        const tJson = (await tRes.json()) as { tenK: TenKSource | null };
        setLatestTenK(tJson.tenK ?? null);
      } else {
        setLatestTenK(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, [base, companyName]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const terms = useMemo(() => {
    return generatePublicRecordsSearchTerms({
      companyName: profileDraft.companyName ?? companyName,
      ticker: tk,
      legalNames: profileDraft.legalNames ?? [],
      formerNames: profileDraft.formerNames ?? [],
      dbaNames: profileDraft.dbaNames ?? [],
      subsidiaryNames: profileDraft.subsidiaryNames ?? [],
      borrowerNames: profileDraft.borrowerNames ?? [],
      guarantorNames: profileDraft.guarantorNames ?? [],
      issuerNames: profileDraft.issuerNames ?? [],
      parentCompanyNames: profileDraft.parentCompanyNames ?? [],
      operatingCompanyNames: profileDraft.operatingCompanyNames ?? [],
      restrictedSubsidiaryNames: profileDraft.restrictedSubsidiaryNames ?? [],
      unrestrictedSubsidiaryNames: profileDraft.unrestrictedSubsidiaryNames ?? [],
    });
  }, [profileDraft, companyName, tk]);

  const stats = useMemo(() => {
    const checked = checklist.filter((c) => c.status !== "not_started").length;
    const unresolved = checklist.filter((c) =>
      ["needs_follow_up", "potential_match", "blocked_login_required", "blocked_fee_required"].includes(c.status)
    ).length;
    const high = records.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical").length;
    const regTotal = registry.length;
    let coverage: "high" | "medium" | "low" = "low";
    if (checked >= Math.max(3, regTotal * 0.4) && (profileDraft.borrowerNames?.length ?? 0) > 0) coverage = "high";
    else if (checked >= 1 && profileDraft.hqState) coverage = "medium";
    return { checked, unresolved, high, regTotal, coverage };
  }, [checklist, records, registry.length, profileDraft]);

  const categoryCounts = useMemo(() => {
    const m = new Map<PublicRecordCategory, { findings: number; unchecked: number }>();
    for (const c of PUBLIC_RECORD_CATEGORIES_ORDER) {
      m.set(c, { findings: 0, unchecked: 0 });
    }
    for (const r of records) {
      const x = m.get(r.category);
      if (x) x.findings++;
    }
    const keys = new Set(checklist.map((c) => `${c.category}:${c.sourceKey}`));
    for (const rec of recommended) {
      const cat = rec.source.category;
      const entry = m.get(cat);
      if (!entry) continue;
      if (!rec.checklist || rec.checklist.status === "not_started") entry.unchecked++;
    }
    return m;
  }, [records, checklist, recommended]);

  async function ingest10K() {
    setSecBusy(true);
    setError(null);
    setSecHint(null);
    try {
      const res = await fetch(`${base}/ingest-10k`, { method: "POST" });
      const j = (await res.json()) as {
        profile?: Profile;
        prefill?: { sources: string[]; warnings: string[] };
        error?: string;
      };
      if (!res.ok) {
        throw new Error(j.error ?? "10-K ingest failed.");
      }
      if (j.prefill) {
        setSecHint({ sources: j.prefill.sources, warnings: j.prefill.warnings });
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "10-K ingest failed.");
    } finally {
      setSecBusy(false);
    }
  }

  async function saveProfile() {
    const res = await fetch(`${base}/profile`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...profileDraft,
        legalNames: profileDraft.legalNames ?? [],
        formerNames: profileDraft.formerNames ?? [],
      }),
    });
    if (!res.ok) {
      setError("Could not save profile.");
      return;
    }
    const j = (await res.json()) as { profile: Profile };
    setProfile(j.profile);
    setProfileDraft(j.profile);
  }

  async function upsertCheck(rec: Recommended, status: string) {
    const res = await fetch(`${base}/checklist`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceKey: rec.sourceKey,
        category: rec.source.category,
        status,
        notes: rec.checklist?.notes ?? "",
        entityName: profileDraft.companyName ?? "",
        jurisdictionName: rec.source.jurisdictionName,
      }),
    });
    if (res.ok) void refresh();
  }

  async function runSnapshot() {
    const res = await fetch(`${base}/search-runs`, { method: "POST" });
    if (res.ok) void refresh();
  }

  const catDisclaimer =
    activeCategory === "tax_liens_releases"
      ? TAX_LIEN_DISCLAIMER
      : activeCategory === "ucc_secured_debt"
        ? UCC_DISCLAIMER
        : activeCategory === "real_estate_recorder"
          ? REAL_ESTATE_DISCLAIMER
          : null;

  if (!tk) return <p className="text-sm text-[var(--muted)]">Select a company.</p>;

  return (
    <div className="space-y-6">
      <p className="rounded border border-[var(--border)] bg-[var(--card2)]/40 px-3 py-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {DISCLAIMER_MAIN}
      </p>

      {error && (
        <div className="rounded border border-[var(--danger)]/40 px-3 py-2 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </div>
      )}

      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(15.5rem,20rem)_minmax(0,1fr)] lg:items-start lg:gap-6">
        <aside
          className="order-first shrink-0 lg:sticky lg:top-3 lg:max-h-[calc(100vh-2rem)] lg:self-start lg:overflow-y-auto"
          aria-label="Public records navigation"
        >
          <details open className="group">
            <summary
              className="mb-2 cursor-pointer list-none text-[10px] font-semibold uppercase tracking-wide [&::-webkit-details-marker]:hidden"
              style={{ color: "var(--muted2)" }}
            >
              <span className="flex items-center justify-between gap-2">
                Workspace
                <span className="text-[9px] opacity-60 group-open:rotate-180">▼</span>
              </span>
            </summary>
            <nav className="mb-4 flex flex-col gap-1 border-l border-[var(--border)] pl-2" aria-label="Workspace sections">
              {PUBLIC_RECORDS_WORKSPACE_NAV.map((item) => {
                const selected = activeMainSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveMainSection(item.id)}
                    className={`w-full rounded-md border px-2.5 py-2 text-left text-[11px] font-medium leading-snug transition ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--card2)] shadow-sm"
                        : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted2)]"
                    }`}
                    style={{ color: "var(--text)" }}
                  >
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </details>

          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Categories
          </p>
          <nav className="flex flex-col gap-1" aria-label="Record categories">
            {PUBLIC_RECORD_CATEGORIES_ORDER.map((cat) => {
              const cc = categoryCounts.get(cat) ?? { findings: 0, unchecked: 0 };
              const selected = activeMainSection === "category" && activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => {
                    setActiveCategory(cat);
                    setActiveMainSection("category");
                  }}
                  className={`w-full rounded-md border px-2.5 py-2 text-left text-[11px] font-medium leading-snug transition ${
                    selected
                      ? "border-[var(--accent)] bg-[var(--card2)] shadow-sm"
                      : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--muted2)]"
                  }`}
                >
                  <span className="block" style={{ color: "var(--text)" }}>
                    {PUBLIC_RECORD_CATEGORY_LABELS[cat]}
                  </span>
                  <span className="mt-1 block text-[10px] font-normal" style={{ color: "var(--muted)" }}>
                    Findings: {cc.findings} · Open checks: {cc.unchecked}
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-6">
          {activeMainSection === "profile" && (
      <Card title="Public records profile">
        <div className="mb-3 rounded border border-[var(--border)] bg-[var(--card2)]/30 px-3 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
          <div className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Latest Form 10-K (SEC EDGAR)
          </div>
          <p className="mt-1 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
            Resolved live from the SEC EDGAR Data API (<code className="rounded bg-[var(--card)] px-1">data.sec.gov</code> submissions, then Archives). This is independent of the Saved Documents tab.
          </p>
          {loading ? (
            <p className="mt-1 text-[10px]">Loading filing link…</p>
          ) : latestTenK ? (
            <div className="mt-2 space-y-2">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="font-mono text-[10px]" style={{ color: "var(--text)" }}>
                  {latestTenK.form} · Filed {latestTenK.filingDate}
                </span>
                <a
                  href={latestTenK.docUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="break-all text-[11px] underline"
                  style={{ color: "var(--accent)" }}
                >
                  Open primary document
                </a>
              </div>
              <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
                Opens the SEC-hosted filing document (often HTML). Click <strong style={{ color: "var(--text)" }}>Ingest 10-K</strong> to merge
                registrant data and latest 10-K text hints into this profile and save to your account (same rules as manual edits—review before relying on coverage).
              </p>
              <button
                type="button"
                disabled={loading || secBusy}
                onClick={() => void ingest10K()}
                className="rounded bg-[var(--accent)] px-3 py-1.5 text-[11px] font-semibold text-[var(--accent-fg)] disabled:opacity-50"
              >
                {secBusy ? "Ingesting…" : "Ingest 10-K"}
              </button>
            </div>
          ) : (
            <p className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
              No qualifying annual report (10-K family) found via EDGAR for this ticker—searched SEC submissions data, not your saved files. Try the exact SEC symbol (class shares often use a hyphen, e.g. BRK-B), paste a 6–10 digit CIK, or remember some foreign issuers file 20-F instead of 10-K.
            </p>
          )}
        </div>

        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <p className="max-w-[720px] text-[11px]" style={{ color: "var(--muted)" }}>
            Edit legal names, borrowers, guarantors, subsidiaries, and HQ geography. Arrays are one entry per line. After ingest, review fields and use{" "}
            <strong style={{ color: "var(--text)" }}>Save profile</strong> if you change anything further (ingest already persists merged SEC hints).
          </p>
        </div>
        {secHint && (
          <div className="mb-3 rounded border border-[var(--border)] bg-[var(--card2)]/30 px-3 py-2 text-[10px]" style={{ color: "var(--muted)" }}>
            <div className="font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              Last 10-K ingest — sources
            </div>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              {secHint.sources.slice(0, 8).map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            {secHint.warnings.length > 0 && (
              <>
                <div className="mt-2 font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
                  Notes
                </div>
                <ul className="mt-1 list-inside list-disc space-y-0.5">
                  {secHint.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </>
            )}
          </div>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Display / legal name
            <input
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              value={profileDraft.companyName ?? ""}
              onChange={(e) => setProfileDraft((p) => ({ ...p, companyName: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            HQ state (2-letter)
            <input
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm uppercase"
              maxLength={2}
              value={profileDraft.hqState ?? ""}
              onChange={(e) => setProfileDraft((p) => ({ ...p, hqState: e.target.value.toUpperCase() }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            HQ county
            <input
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
              value={profileDraft.hqCounty ?? ""}
              onChange={(e) => setProfileDraft((p) => ({ ...p, hqCounty: e.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            State of incorporation
            <input
              className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-sm uppercase"
              maxLength={2}
              value={profileDraft.stateOfIncorporation ?? ""}
              onChange={(e) => setProfileDraft((p) => ({ ...p, stateOfIncorporation: e.target.value.toUpperCase() }))}
            />
          </label>
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {(
            [
              ["legalNames", "Legal names"],
              ["formerNames", "Former names"],
              ["dbaNames", "DBA names"],
              ["subsidiaryNames", "Subsidiaries"],
              ["borrowerNames", "Borrower entities"],
              ["guarantorNames", "Guarantors"],
              ["issuerNames", "Issuer entities"],
              ["parentCompanyNames", "Parent companies"],
              ["operatingCompanyNames", "Operating companies"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              {label}
              <textarea
                rows={3}
                className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 font-mono text-[11px]"
                value={(profileDraft[key] as string[] | undefined)?.join("\n") ?? ""}
                onChange={(e) =>
                  setProfileDraft((p) => ({ ...p, [key]: linesToArr(e.target.value) } as Partial<Profile>))
                }
              />
            </label>
          ))}
        </div>
        <label className="mt-3 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Principal executive office / address
          <textarea
            rows={2}
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            value={profileDraft.principalExecutiveOfficeAddress ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, principalExecutiveOfficeAddress: e.target.value }))}
          />
        </label>
        <label className="mt-3 flex flex-col gap-1 text-[10px] font-medium uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
          Notes
          <textarea
            rows={3}
            className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-sm"
            value={profileDraft.notes ?? ""}
            onChange={(e) => setProfileDraft((p) => ({ ...p, notes: e.target.value }))}
          />
        </label>
        <button
          type="button"
          onClick={() => void saveProfile()}
          disabled={loading}
          className="mt-3 rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)] disabled:opacity-50"
        >
          Save profile
        </button>
      </Card>
          )}

          {activeMainSection === "coverage" && (
      <Card title="Coverage summary">
        <div className="flex flex-wrap items-center gap-3 text-[11px]" style={{ color: "var(--muted)" }}>
          <span>
            Registry sources (MVP): <strong style={{ color: "var(--text)" }}>{stats.regTotal}</strong>
          </span>
          <span>
            Sources checked: <strong style={{ color: "var(--text)" }}>{stats.checked}</strong>
          </span>
          <span>
            Unresolved checklist flags: <strong style={{ color: "var(--text)" }}>{stats.unresolved}</strong>
          </span>
          <span>
            High/critical findings: <strong style={{ color: "var(--text)" }}>{stats.high}</strong>
          </span>
          <CoverageBadge q={stats.coverage} />
          <button
            type="button"
            onClick={() => void runSnapshot()}
            className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold uppercase tracking-wide"
          >
            Save diligence snapshot
          </button>
        </div>
        <p className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
          High coverage means principal entities plus HQ geography are reflected and a meaningful share of recommended sources are checked.
          Medium/low indicates gaps—often paywalls, logins, or incomplete county coverage.
        </p>
      </Card>
          )}

          {activeMainSection === "searchTerms" && (
      <Card title="Generated search terms">
        <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
          Entity variants and category hints for clipboard / portal searches. This app does not automate third-party sites.
        </p>
        <div className="flex flex-wrap gap-1">
          {terms.entityNameVariants.slice(0, 40).map((t) => (
            <button
              key={t}
              type="button"
              title="Copy"
              className="rounded border border-[var(--border)] px-2 py-0.5 font-mono text-[10px]"
              style={{ color: "var(--text)" }}
              onClick={() => void navigator.clipboard.writeText(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10px]" style={{ color: "var(--muted2)" }}>
          {REGISTRY_DISCLAIMER}
        </p>
      </Card>
          )}

          {activeMainSection === "category" && (
      <Card title={PUBLIC_RECORD_CATEGORY_LABELS[activeCategory]}>
        <p className="mb-3 text-[11px]" style={{ color: "var(--muted)" }}>
          Choose a category in the sidebar for diligence notes, recommended sources, and checklist actions. Use Workspace in the sidebar for profile, coverage, search terms, findings, and document upload.
        </p>
        <div
          role="tabpanel"
          aria-label={PUBLIC_RECORD_CATEGORY_LABELS[activeCategory]}
          className="rounded border border-[var(--border)] bg-[var(--card)]/40 px-3 py-3"
        >
          <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
            {PUBLIC_RECORD_CATEGORY_DESCRIPTIONS[activeCategory]}
          </p>
          {catDisclaimer && (
            <p className="mt-3 rounded border border-[var(--border)] px-2 py-1.5 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
              {catDisclaimer}
            </p>
          )}
          <h5 className="mb-2 mt-4 text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Recommended sources
          </h5>
          <ul className="space-y-2 text-[11px]">
            {recommended
              .filter((r) => r.source.category === activeCategory)
              .map((r) => (
                <li key={r.sourceKey} className="rounded border border-[var(--border)] px-2 py-2" style={{ color: "var(--text)" }}>
                  <div className="font-medium">{r.source.sourceName}</div>
                  <div style={{ color: "var(--muted)" }}>{r.reason}</div>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <a className="underline" href={r.source.sourceUrl} target="_blank" rel="noreferrer">
                      Open source
                    </a>
                    <button type="button" className="underline" onClick={() => void navigator.clipboard.writeText(terms.categoryTerms[activeCategory].join(", "))}>
                      Copy search terms
                    </button>
                    <button type="button" className="underline" onClick={() => void upsertCheck(r, "searched_no_result")}>
                      Mark checked (no result)
                    </button>
                    <button type="button" className="underline" onClick={() => void upsertCheck(r, "confirmed_result")}>
                      Mark match found
                    </button>
                  </div>
                  {r.checklist && (
                    <div className="mt-1 text-[10px]" style={{ color: "var(--muted2)" }}>
                      Status: {r.checklist.status}
                      {r.checklist.checkedAt ? ` · ${r.checklist.checkedAt.slice(0, 10)}` : ""}
                    </div>
                  )}
                </li>
              ))}
            {recommended.filter((r) => r.source.category === activeCategory).length === 0 && (
              <li style={{ color: "var(--muted)" }}>No MVP registry entries for this category yet—add a custom source from the API or extend the registry.</li>
            )}
          </ul>
        </div>
      </Card>
          )}

          {activeMainSection === "findings" && (
      <Card title="All findings">
        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold"
            onClick={() => {
              setActiveMainSection("findings");
              setSuggestions({});
              setModalOpen(true);
            }}
          >
            Add finding
          </button>
          <ExportCsvButton
            records={records}
            ticker={tk}
            companyLabel={profileDraft.companyName ?? companyName ?? tk}
            stats={stats}
            checklist={checklist}
            categoryCounts={categoryCounts}
            recommendedCount={recommended.length}
          />
        </div>
        <DataTable>
          <thead>
            <tr>
              <th>Category</th>
              <th>Searched</th>
              <th>Match</th>
              <th>Type</th>
              <th>Status</th>
              <th>Date</th>
              <th>Jurisdiction</th>
              <th>Risk</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr key={r.id}>
                <td className="text-[10px]">{PUBLIC_RECORD_CATEGORY_LABELS[r.category]}</td>
                <td className="max-w-[120px] truncate text-[10px]">{r.searchedEntityName ?? "—"}</td>
                <td className="max-w-[120px] truncate text-[10px]">{r.matchedEntityName ?? "—"}</td>
                <td className="text-[10px]">{r.recordType ?? "—"}</td>
                <td className="text-[10px]">{r.status}</td>
                <td className="font-mono text-[10px]">{r.filingDate?.slice(0, 10) ?? "—"}</td>
                <td className="text-[10px]">
                  {[r.jurisdictionState, r.jurisdictionCounty].filter(Boolean).join(" / ") || "—"}
                </td>
                <td>
                  <RiskBadge level={r.riskLevel} />
                </td>
                <td className="max-w-[160px] truncate text-[10px]">{r.notes ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        {records.length === 0 && <p className="mt-2 text-sm text-[var(--muted)]">No findings saved yet.</p>}
      </Card>
          )}

          {activeMainSection === "documents" && (
      <Card title="Document upload (PDF)">
        <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
          Upload a PDF to extract suggested fields for review (no auto-save). OCR/scanned PDFs may yield little text.
        </p>
        <DocumentUploadFlow base={base} onExtracted={(s) => { setSuggestions(s); setModalOpen(true); }} />
      </Card>
          )}
        </div>
      </div>

      {modalOpen && (
        <AddRecordModal
          ticker={tk}
          base={base}
          categoryDefault={activeCategory}
          suggestions={suggestions}
          onClose={() => setModalOpen(false)}
          onSaved={() => {
            setModalOpen(false);
            void refresh();
          }}
        />
      )}

      {loading && <p className="text-[11px] text-[var(--muted)]">Loading…</p>}
    </div>
  );
}

function ExportCsvButton({
  records,
  ticker,
  companyLabel,
  stats,
  checklist,
  categoryCounts,
  recommendedCount,
}: {
  records: PublicRecordRow[];
  ticker: string;
  companyLabel: string;
  stats: { checked: number; unresolved: number; high: number; regTotal: number; coverage: "high" | "medium" | "low" };
  checklist: ChecklistRow[];
  categoryCounts: Map<PublicRecordCategory, { findings: number; unchecked: number }>;
  recommendedCount: number;
}) {
  const mkCsv = () => {
    const headers = [
      "category",
      "searchedEntityName",
      "matchedEntityName",
      "recordType",
      "status",
      "filingDate",
      "amount",
      "jurisdictionState",
      "jurisdictionCounty",
      "recordingNumber",
      "caseNumber",
      "riskLevel",
      "confidence",
      "notes",
    ];
    const lines = [
      headers.join(","),
      ...records.map((r) =>
        headers
          .map((h) => {
            const v = (r as unknown as Record<string, unknown>)[h];
            const s = v == null ? "" : String(v);
            return `"${s.replace(/"/g, '""')}"`;
          })
          .join(",")
      ),
    ];
    return lines.join("\n");
  };

  const mkMarkdown = () => {
    const headers = [
      "Category",
      "Searched",
      "Match",
      "Type",
      "Status",
      "Date",
      "State",
      "County",
      "Risk",
      "Notes",
    ];
    const rows = records.map(
      (r) =>
        `| ${[
          r.category,
          r.searchedEntityName ?? "",
          r.matchedEntityName ?? "",
          r.recordType ?? "",
          r.status,
          r.filingDate?.slice(0, 10) ?? "",
          r.jurisdictionState ?? "",
          r.jurisdictionCounty ?? "",
          r.riskLevel,
          (r.notes ?? "").replace(/\|/g, "\\|"),
        ].join(" | ")} |`
    );
    return [`| ${headers.join(" | ")} |`, `| ${headers.map(() => "---").join(" | ")} |`, ...rows].join("\n");
  };

  const mkMemo = () => {
    const lines: string[] = [
      `# State & local public records — ${companyLabel} (${ticker})`,
      "",
      `Generated: ${new Date().toISOString().slice(0, 10)}`,
      "",
      "## Coverage",
      `- Registry sources (MVP): ${stats.regTotal}`,
      `- Recommended sources surfaced: ${recommendedCount}`,
      `- Sources marked checked: ${stats.checked}`,
      `- Unresolved checklist items: ${stats.unresolved}`,
      `- High/critical findings: ${stats.high}`,
      `- Coverage quality (heuristic): ${stats.coverage}`,
      "",
      "## Checklist status counts",
    ];
    const byStatus = new Map<string, number>();
    for (const c of checklist) {
      byStatus.set(c.status, (byStatus.get(c.status) ?? 0) + 1);
    }
    if (byStatus.size === 0) lines.push("- (no checklist rows)");
    else for (const [st, n] of [...byStatus.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`- ${st}: ${n}`);
    }
    lines.push("", "## Findings by category");
    for (const cat of PUBLIC_RECORD_CATEGORIES_ORDER) {
      const cc = categoryCounts.get(cat);
      if (!cc) continue;
      lines.push(
        `- **${PUBLIC_RECORD_CATEGORY_LABELS[cat]}**: ${cc.findings} finding(s); ${cc.unchecked} recommended source(s) still unchecked (where applicable)`
      );
    }
    const hi = records.filter((r) => r.riskLevel === "high" || r.riskLevel === "critical");
    lines.push("", "## High/critical findings");
    if (hi.length === 0) lines.push("- None recorded.");
    else {
      for (const r of hi) {
        lines.push(
          `- [${PUBLIC_RECORD_CATEGORY_LABELS[r.category]}] ${r.recordType ?? "record"} — ${r.matchedEntityName ?? r.searchedEntityName ?? "—"} (${r.jurisdictionState ?? "?"}): ${r.notes ?? "no notes"}`
        );
      }
    }
    lines.push(
      "",
      "---",
      "This memo is a diligence aid. Confirm material items with official filings and counsel."
    );
    return lines.join("\n");
  };

  return (
    <>
      <button
        type="button"
        className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold"
        onClick={() => {
          const blob = new Blob([mkCsv()], { type: "text/csv;charset=utf-8" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${ticker}-public-records.csv`;
          a.click();
          URL.revokeObjectURL(a.href);
        }}
      >
        Export CSV
      </button>
      <button
        type="button"
        className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold"
        onClick={() => void navigator.clipboard.writeText(mkMarkdown())}
      >
        Copy markdown table
      </button>
      <button
        type="button"
        className="rounded border border-[var(--border)] px-2 py-1 text-[10px] font-semibold"
        onClick={() => void navigator.clipboard.writeText(mkMemo())}
      >
        Copy research memo
      </button>
    </>
  );
}

function DocumentUploadFlow({ base, onExtracted }: { base: string; onExtracted: (s: Record<string, string>) => void }) {
  const [busy, setBusy] = useState(false);
  const [docId, setDocId] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-end gap-2">
      <input
        type="file"
        accept="application/pdf"
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          try {
            const fd = new FormData();
            fd.set("file", f);
            const res = await fetch(`${base}/upload-document`, { method: "POST", body: fd });
            const j = (await res.json()) as { document?: { id: string } };
            if (j.document?.id) setDocId(j.document.id);
            const ex = await fetch(`${base}/extract-document-fields`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ documentId: j.document?.id }),
            });
            const ej = (await ex.json()) as { suggestions?: Record<string, string> };
            if (ej.suggestions) {
              const flat: Record<string, string> = {};
              for (const [k, v] of Object.entries(ej.suggestions)) {
                if (v) flat[k] = String(v);
              }
              onExtracted(flat);
            }
          } finally {
            setBusy(false);
          }
        }}
      />
      {docId && (
        <span className="font-mono text-[10px]" style={{ color: "var(--muted2)" }}>
          doc {docId.slice(0, 8)}…
        </span>
      )}
    </div>
  );
}

function AddRecordModal({
  base,
  categoryDefault,
  suggestions,
  onClose,
  onSaved,
}: {
  ticker: string;
  base: string;
  categoryDefault: PublicRecordCategory;
  suggestions: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    category: categoryDefault,
    recordType: suggestions.recordType ?? "",
    searchedEntityName: "",
    matchedEntityName: "",
    status: "unknown",
    filingDate: suggestions.filingDate ?? "",
    amount: suggestions.amount ?? "",
    jurisdictionState: "",
    jurisdictionCounty: "",
    notes: suggestions.summary ?? "",
    riskLevel: "unknown",
    confidence: "medium",
    documentUrl: "",
  });

  async function submit() {
    const res = await fetch(`${base}/records`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (res.ok) onSaved();
  }

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" role="dialog">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-4 shadow-xl">
        <h3 className="mb-3 text-sm font-semibold">Add public record finding</h3>
        <div className="grid gap-2 text-[11px]">
          {(
            [
              ["recordType", "Record type"],
              ["searchedEntityName", "Searched entity"],
              ["matchedEntityName", "Matched entity"],
              ["filingDate", "Filing date (ISO)"],
              ["amount", "Amount"],
              ["jurisdictionState", "State"],
              ["jurisdictionCounty", "County"],
              ["documentUrl", "Document URL"],
              ["notes", "Notes"],
            ] as const
          ).map(([k, lab]) => (
            <label key={k} className="flex flex-col gap-0.5" style={{ color: "var(--muted2)" }}>
              {lab}
              <input
                className="rounded border border-[var(--border)] bg-[var(--card2)] px-2 py-1 text-[var(--text)]"
                value={(form as unknown as Record<string, string>)[k] ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, [k]: e.target.value }))}
              />
            </label>
          ))}
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded border px-3 py-1.5 text-xs" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="rounded bg-[var(--accent)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-fg)]" onClick={() => void submit()}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
