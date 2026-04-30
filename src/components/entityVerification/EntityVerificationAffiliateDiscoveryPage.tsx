"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui";
import {
  ENTITY_INTEL_AGENT_NOTE,
  ENTITY_INTEL_AFFILIATE_NOTE,
  ENTITY_INTEL_EXHIBIT21_NOTE,
  ENTITY_INTEL_TOP_DISCLAIMER,
} from "@/components/entityVerification/entityVerificationCopy";

const baseIntel = (ticker: string) => `/api/companies/${encodeURIComponent(ticker.trim().toUpperCase())}/entity-intelligence`;

type Row = Record<string, unknown>;

function Badge({ tone, children }: { tone: "hi" | "med" | "lo" | "neutral"; children: React.ReactNode }) {
  const c =
    tone === "hi"
      ? "border-rose-700/55 text-rose-200 bg-rose-950/40"
      : tone === "med"
        ? "border-amber-700/55 text-amber-200 bg-amber-950/35"
        : tone === "lo"
          ? "border-emerald-800/50 text-emerald-200 bg-emerald-950/35"
          : "border-[var(--border)] text-[var(--muted)] bg-[var(--card2)]/40";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${c}`}>
      {children}
    </span>
  );
}

function SevBadge({ severity }: { severity: string }) {
  const tone = severity === "critical" ? "hi" : severity === "high" ? "hi" : severity === "medium" ? "med" : "lo";
  return <Badge tone={tone}>{severity}</Badge>;
}

/** Minimal relationship map — candidate set depends on `candidateMode` (broad vs confirmed-only). */
function EntityRelationshipGraph({
  verified,
  candidates,
  relationships,
  candidateMode,
}: {
  verified: Row[];
  candidates: Row[];
  relationships: Row[];
  candidateMode: "broad_non_rejected" | "confirmed_only";
}) {
  const candFiltered =
    candidateMode === "broad_non_rejected"
      ? candidates.filter((c) => String(c.reviewStatus) !== "rejected")
      : candidates.filter((c) => String(c.reviewStatus) === "confirmed_affiliate");

  type Node = { id: string; label: string; kind: string };
  const nodes: Node[] = [];
  const ids = new Set<string>();

  const addNode = (label: unknown, kind: string) => {
    const s = typeof label === "string" ? label.trim() : "";
    if (!s) return;
    const id = `${kind}:${s}`.slice(0, 200);
    if (ids.has(id)) return;
    ids.add(id);
    nodes.push({ id, label: s, kind });
  };

  verified.forEach((v) => addNode(v.officialEntityName ?? v.searchedName, "verified"));
  candFiltered.forEach((c) => addNode(c.candidateEntityName, "candidate"));
  relationships.forEach((r) => {
    addNode(r.parentEntityName, "parent");
    addNode(r.childEntityName, "child");
  });

  const W = 640;
  const H = 340;
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.32;
  const pos = nodes.map((_, i) => {
    const a = (2 * Math.PI * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    return { x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) };
  });

  return (
    <div className="overflow-x-auto">
      <svg width={W} height={H} className="mx-auto rounded border border-[var(--border)] bg-[var(--card)]">
        <text x={12} y={18} fill="var(--muted2)" fontSize={11}>
          Relationship map — positions are illustrative only; filters apply.
        </text>
        {relationships.slice(0, 80).map((r, i) => {
          const pi = nodes.findIndex((n) => n.label === r.parentEntityName);
          const ci = nodes.findIndex((n) => n.label === r.childEntityName);
          if (pi < 0 || ci < 0) return null;
          const a = pos[pi]!;
          const b = pos[ci]!;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="var(--muted2)"
              strokeWidth={1}
              strokeOpacity={0.45}
            />
          );
        })}
        {nodes.map((n, i) => {
          const p = pos[i]!;
          const fill =
            n.kind === "verified" ? "var(--accent)" : n.kind === "candidate" ? "#7c3aed" : "var(--muted)";
          return (
            <g key={n.id} transform={`translate(${p.x},${p.y})`}>
              <circle r={6} fill={fill} opacity={0.9} />
              <text x={10} y={4} fill="var(--text)" fontSize={10} style={{ maxWidth: 180 }}>
                {n.label.length > 48 ? `${n.label.slice(0, 46)}…` : n.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function EntityVerificationAffiliateDiscoveryPage({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string;
}) {
  const tk = ticker.trim().toUpperCase();
  const [busy, setBusy] = useState(false);
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [showCandInGraph, setShowCandInGraph] = useState(true);

  const [known, setKnown] = useState<Row[]>([]);
  const [verified, setVerified] = useState<Row[]>([]);
  const [tasks, setTasks] = useState<Row[]>([]);
  const [candidates, setCandidates] = useState<Row[]>([]);
  const [relationships, setRelationships] = useState<Row[]>([]);
  const [events, setEvents] = useState<Row[]>([]);
  const [issues, setIssues] = useState<Row[]>([]);

  const [pkgDraft, setPkgDraft] = useState<Row>({});

  const [manualVerifiedOpen, setManualVerifiedOpen] = useState(false);
  const [manualVerified, setManualVerified] = useState({
    searchedName: "",
    officialEntityName: "",
    state: "",
    sourceName: "",
    sourceUrl: "",
    knownEntityInputId: "",
    verificationStatus: "verified_exact_match",
    sosStatus: "active",
  });
  const [manualKnownOpen, setManualKnownOpen] = useState(false);
  const [manualKnown, setManualKnown] = useState({
    entityName: "",
    sourceType: "user_input",
    entityRole: "unknown",
  });
  const load = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    try {
      const [pRes, kRes, vRes, tRes, cRes, rRes, eRes, iRes] = await Promise.all([
        fetch(`${baseIntel(tk)}/profile?companyName=${encodeURIComponent(companyName ?? "")}`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/known-entities`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/verified-entities`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/search-tasks`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/candidates`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/relationships`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/events`, { credentials: "same-origin" }),
        fetch(`${baseIntel(tk)}/issues`, { credentials: "same-origin" }),
      ]);
      if (pRes.ok) {
        const j = (await pRes.json()) as { profile: Row };
        setPkgDraft(j.profile);
      }
      if (kRes.ok) setKnown(((await kRes.json()) as { items: Row[] }).items);
      if (vRes.ok) setVerified(((await vRes.json()) as { items: Row[] }).items);
      if (tRes.ok) setTasks(((await tRes.json()) as { items: Row[] }).items);
      if (cRes.ok) setCandidates(((await cRes.json()) as { items: Row[] }).items);
      if (rRes.ok) setRelationships(((await rRes.json()) as { items: Row[] }).items);
      if (eRes.ok) setEvents(((await eRes.json()) as { items: Row[] }).items);
      if (iRes.ok) setIssues(((await iRes.json()) as { items: Row[] }).items);
    } finally {
      setBusy(false);
    }
  }, [tk, companyName]);

  useEffect(() => {
    void load();
  }, [load]);

  const savePackage = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    try {
      const res = await fetch(`${baseIntel(tk)}/profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(pkgDraft),
      });
      if (res.ok) {
        const j = (await res.json()) as { profile: Row };
        setPkgDraft(j.profile);
      }
    } finally {
      setBusy(false);
    }
  }, [tk, pkgDraft]);

  const runAction = useCallback(
    async (path: string, method: "POST" = "POST") => {
      if (!tk) return;
      setBusy(true);
      try {
        const res = await fetch(`${baseIntel(tk)}${path}`, { method, credentials: "same-origin" });
        if (res.ok) await load();
      } finally {
        setBusy(false);
      }
    },
    [tk, load],
  );

  const verifyByKnown = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const v of verified) {
      const id = v.knownEntityInputId as string | undefined;
      if (!id) continue;
      m.set(id, [...(m.get(id) ?? []), v]);
    }
    return m;
  }, [verified]);

  const copy = (s: string) => void navigator.clipboard.writeText(s);

  const exhibitRows = known.filter((k) => k.sourceType === "exhibit_21");
  const creditRoles = new Set(["borrower", "guarantor", "issuer", "co_issuer", "collateral_owner"]);
  const creditRows = known.filter((k) => creditRoles.has(String(k.entityRole)));

  return (
    <div className="space-y-6">
      <div className="rounded border border-[var(--border)] bg-[var(--card)]/50 px-3 py-2 text-[11px] leading-relaxed" style={{ color: "var(--muted)" }}>
        {ENTITY_INTEL_TOP_DISCLAIMER}
      </div>

      <div className="flex flex-wrap gap-2 text-[10px]">
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void runAction("/bootstrap-from-public-profile", "POST")}
        >
          Sync from Public Records profile
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void runAction("/generate-search-tasks", "POST")}
        >
          Generate SOS search tasks
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void runAction("/discover-candidates", "POST")}
        >
          Discover candidate affiliates
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void runAction("/score-candidates", "POST")}
        >
          Score candidates
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void runAction("/generate-issues", "POST")}
        >
          Regenerate issues
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const res = await fetch(`${baseIntel(tk)}/export`, { method: "POST", credentials: "same-origin" });
              if (res.ok) {
                const j = (await res.json()) as Record<string, string>;
                const blob = new Blob([JSON.stringify(j, null, 2)], { type: "application/json" });
                const u = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = u;
                a.download = `${tk}-entity-intelligence-export.json`;
                a.click();
                URL.revokeObjectURL(u);
              }
            } finally {
              setBusy(false);
            }
          }}
        >
          Export JSON bundle
        </button>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-1 hover:border-[var(--accent)]"
          style={{ color: "var(--text)" }}
          disabled={busy}
          onClick={() => void load()}
        >
          Refresh
        </button>
      </div>

      <section id="entity-input-package">
        <Card title="1. Entity input package">
          <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
            Pulls defaults from your Public Records profile when you sync; edit and save to drive search generation.
          </p>
          <div className="grid gap-2 md:grid-cols-2 text-[11px]">
            {(
              [
                ["companyName", "Public company name"],
                ["publicRegistrantName", "Registrant legal name"],
                ["tickerLabel", "Ticker"],
                ["stateOfIncorporation", "State of incorporation"],
                ["hqAddress", "HQ address (line)"],
                ["hqCity", "HQ city"],
                ["hqState", "HQ state"],
                ["hqZip", "HQ ZIP"],
                ["principalExecutiveOfficeAddress", "Principal executive office"],
                ["source10KUrl", "10-K source URL"],
                ["source10KDate", "10-K date (YYYY-MM-DD)"],
                ["notes", "Notes"],
              ] as const
            ).map(([key, label]) => {
              if (key === "tickerLabel") {
                return (
                  <label key={key} className="flex flex-col gap-0.5">
                    <span style={{ color: "var(--muted2)" }}>{label}</span>
                    <input className="rounded border border-[var(--border)] bg-transparent px-2 py-1" readOnly value={tk} />
                  </label>
                );
              }
              const v = (pkgDraft[key as keyof typeof pkgDraft] as string | undefined) ?? "";
              return (
                <label key={key} className="flex flex-col gap-0.5">
                  <span style={{ color: "var(--muted2)" }}>{label}</span>
                  {key === "notes" || key === "principalExecutiveOfficeAddress" || key === "hqAddress" ? (
                    <textarea
                      className="min-h-[4rem] rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px]"
                      value={v}
                      onChange={(e) => setPkgDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  ) : (
                    <input
                      className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px]"
                      value={v}
                      onChange={(e) => setPkgDraft((d) => ({ ...d, [key]: e.target.value }))}
                    />
                  )}
                </label>
              );
            })}
            <label className="md:col-span-2 flex flex-col gap-0.5">
              <span style={{ color: "var(--muted2)" }}>Major operating states (comma-separated)</span>
              <input
                className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px]"
                value={Array.isArray(pkgDraft.majorOperatingStates) ? (pkgDraft.majorOperatingStates as string[]).join(", ") : ""}
                onChange={(e) =>
                  setPkgDraft((d) => ({
                    ...d,
                    majorOperatingStates: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
            <label className="md:col-span-2 flex flex-col gap-0.5">
              <span style={{ color: "var(--muted2)" }}>Major facility / property addresses (one per line)</span>
              <textarea
                className="min-h-[5rem] rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono text-[11px]"
                value={
                  Array.isArray(pkgDraft.majorFacilityAddresses)
                    ? (pkgDraft.majorFacilityAddresses as string[]).join("\n")
                    : ""
                }
                onChange={(e) =>
                  setPkgDraft((d) => ({
                    ...d,
                    majorFacilityAddresses: e.target.value
                      .split("\n")
                      .map((s) => s.trim())
                      .filter(Boolean),
                  }))
                }
              />
            </label>
          </div>
          <button
            type="button"
            className="mt-3 rounded border border-[var(--accent)] px-3 py-1.5 text-[11px] font-medium"
            style={{ color: "var(--text)" }}
            disabled={busy}
            onClick={() => void savePackage()}
          >
            Save entity package
          </button>
        </Card>
      </section>

      <section id="known-verification">
        <Card title="2. Known entity verification">
          <p className="mb-2 text-[10px]" style={{ color: "var(--muted2)" }}>
            {ENTITY_INTEL_AGENT_NOTE}
          </p>
          <div className="mb-3 flex flex-wrap gap-3 text-[11px]">
            <button type="button" className="underline" onClick={() => setManualKnownOpen((v) => !v)}>
              {manualKnownOpen ? "Hide add known entity" : "Add known entity"}
            </button>
            <button type="button" className="underline" onClick={() => setManualVerifiedOpen((v) => !v)}>
              {manualVerifiedOpen ? "Hide add verified record" : "Add verified SOS record (manual capture)"}
            </button>
          </div>
          {manualKnownOpen ? (
            <form
              className="mb-4 rounded border border-[var(--border)] px-3 py-2 text-[11px]"
              style={{ color: "var(--text)" }}
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch(`${baseIntel(tk)}/known-entities`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({
                    entityName: manualKnown.entityName,
                    sourceType: manualKnown.sourceType,
                    entityRole: manualKnown.entityRole,
                  }),
                });
                setManualKnown({ entityName: "", sourceType: "user_input", entityRole: "unknown" });
                void load();
              }}
            >
              <div className="grid gap-2 md:grid-cols-3">
                <label className="flex flex-col gap-0.5">
                  Entity name
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualKnown.entityName}
                    onChange={(e) => setManualKnown((x) => ({ ...x, entityName: e.target.value }))}
                    required
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Source type
                  <select
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualKnown.sourceType}
                    onChange={(e) => setManualKnown((x) => ({ ...x, sourceType: e.target.value }))}
                  >
                    {["user_input", "exhibit_21", "credit_agreement", "indenture", "prior_research", "other"].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  Role
                  <select
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualKnown.entityRole}
                    onChange={(e) => setManualKnown((x) => ({ ...x, entityRole: e.target.value }))}
                  >
                    {[
                      "subsidiary",
                      "borrower",
                      "guarantor",
                      "issuer",
                      "dba",
                      "former_name",
                      "operating_company",
                      "unknown",
                    ].map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="mt-2 rounded border border-[var(--accent)] px-2 py-1 text-[11px]">
                Save known entity
              </button>
            </form>
          ) : null}
          {manualVerifiedOpen ? (
            <form
              className="mb-4 rounded border border-[var(--border)] px-3 py-2 text-[11px]"
              style={{ color: "var(--text)" }}
              onSubmit={async (e) => {
                e.preventDefault();
                await fetch(`${baseIntel(tk)}/verified-entities`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  credentials: "same-origin",
                  body: JSON.stringify({
                    searchedName: manualVerified.searchedName || manualVerified.officialEntityName,
                    officialEntityName: manualVerified.officialEntityName,
                    state: manualVerified.state,
                    sourceName: manualVerified.sourceName,
                    sourceUrl: manualVerified.sourceUrl,
                    knownEntityInputId: manualVerified.knownEntityInputId.trim() || null,
                    verificationStatus: manualVerified.verificationStatus,
                    status: manualVerified.sosStatus,
                  }),
                });
                void load();
              }}
            >
              <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">
                <label className="flex flex-col gap-0.5">
                  Link to known input (optional id)
                  <select
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualVerified.knownEntityInputId}
                    onChange={(e) => setManualVerified((x) => ({ ...x, knownEntityInputId: e.target.value }))}
                  >
                    <option value="">— none —</option>
                    {known.map((k) => (
                      <option key={String(k.id)} value={String(k.id)}>
                        {String(k.entityName).slice(0, 72)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  Searched name
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualVerified.searchedName}
                    onChange={(e) => setManualVerified((x) => ({ ...x, searchedName: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Official SOS name *
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    required
                    value={manualVerified.officialEntityName}
                    onChange={(e) => setManualVerified((x) => ({ ...x, officialEntityName: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  State *
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    required
                    placeholder="DE"
                    value={manualVerified.state}
                    onChange={(e) => setManualVerified((x) => ({ ...x, state: e.target.value.toUpperCase() }))}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Source name *
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    required
                    value={manualVerified.sourceName}
                    onChange={(e) => setManualVerified((x) => ({ ...x, sourceName: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-0.5 md:col-span-2">
                  Source URL *
                  <input
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    required
                    value={manualVerified.sourceUrl}
                    onChange={(e) => setManualVerified((x) => ({ ...x, sourceUrl: e.target.value }))}
                  />
                </label>
                <label className="flex flex-col gap-0.5">
                  Verification outcome
                  <select
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualVerified.verificationStatus}
                    onChange={(e) => setManualVerified((x) => ({ ...x, verificationStatus: e.target.value }))}
                  >
                    {[
                      "verified_exact_match",
                      "verified_probable_match",
                      "potential_match",
                      "no_match_found",
                      "blocked_login_required",
                      "blocked_fee_required",
                      "unresolved",
                    ].map((o) => (
                      <option key={o} value={o}>
                        {o.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-0.5">
                  SOS status snapshot
                  <select
                    className="rounded border border-[var(--border)] bg-transparent px-2 py-1 font-mono"
                    value={manualVerified.sosStatus}
                    onChange={(e) => setManualVerified((x) => ({ ...x, sosStatus: e.target.value }))}
                  >
                    {["active", "good_standing", "inactive", "dissolved", "unknown"].map((o) => (
                      <option key={o} value={o}>
                        {o.replace(/_/g, " ")}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="submit" className="mt-2 rounded border border-[var(--accent)] px-2 py-1 text-[11px]">
                Save verified record
              </button>
            </form>
          ) : null}
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[880px] border-collapse text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted2)" }}>
                  {["Input name", "Source", "Role", "Jurisdiction hint", "Verified SOS name", "State", "Status", "Confidence", "Actions"].map(
                    (h) => (
                      <th key={h} className="border-b border-[var(--border)] bg-[var(--card2)]/40 px-2 py-2 font-semibold">
                        {h}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {known.map((k) => {
                  const vv = verifyByKnown.get(String(k.id))?.[0];
                  return (
                    <tr key={String(k.id)} style={{ color: "var(--text)" }}>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{String(k.entityName)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{String(k.sourceType)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{String(k.entityRole)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{k.jurisdictionHint ? String(k.jurisdictionHint) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">
                        {vv ? String(vv.officialEntityName) : <span style={{ color: "var(--muted)" }}>unverified entity</span>}
                      </td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{vv ? String(vv.state) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">{vv ? String(vv.status) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">
                        {vv ? <Badge tone="neutral">{String(vv.confidence)}</Badge> : "—"}
                      </td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5 align-top">
                        <div className="flex flex-col gap-1">
                          <button type="button" className="text-left underline" onClick={() => copy(String(k.entityName))}>
                            Copy search term
                          </button>
                          {vv?.sourceUrl ? (
                            <a className="underline" href={String(vv.sourceUrl)} target="_blank" rel="noreferrer">
                              Open source
                            </a>
                          ) : null}
                          <button type="button" className="text-left underline" onClick={() => setDrawer(k)}>
                            Evidence (input)
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="search-tasks">
        <Card title="3. Official search tasks">
          <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
            Open each official portal manually. No automated searches or paywall bypass are performed from this app.
          </p>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[780px] border-collapse text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted2)" }}>
                  {["Entity", "State", "Source", "Reason", "Status", "Actions"].map((h) => (
                    <th key={h} className="border-b border-[var(--border)] bg-[var(--card2)]/40 px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((t) => (
                  <tr key={String(t.id)} style={{ color: "var(--text)" }}>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(t.entityName)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(t.state)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">
                      <a className="underline" href={String(t.sourceUrl)} target="_blank" rel="noreferrer">
                        {String(t.sourceName)}
                      </a>
                    </td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(t.searchReason)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(t.searchStatus)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">
                      <div className="flex flex-col gap-1">
                        <button type="button" className="text-left underline" onClick={() => copy(String(t.entityName))}>
                          Copy search term
                        </button>
                        <button
                          type="button"
                          className="text-left underline"
                          onClick={async () => {
                            await fetch(`${baseIntel(tk)}/search-tasks/${String(t.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              credentials: "same-origin",
                              body: JSON.stringify({ searchStatus: "searched_no_result", checkedAt: new Date().toISOString() }),
                            });
                            void load();
                          }}
                        >
                          Mark searched / no result
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="exhibit21">
        <Card title="4. Exhibit 21 reconciliation">
          <p className="mb-2 text-[10px]" style={{ color: "var(--muted2)" }}>
            {ENTITY_INTEL_EXHIBIT21_NOTE}
          </p>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[720px] border-collapse text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted2)" }}>
                  {["Exhibit 21 name", "Verified?", "SOS name", "State", "Status", "Issue hint"].map((h) => (
                    <th key={h} className="border-b border-[var(--border)] bg-[var(--card2)]/40 px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {exhibitRows.map((k) => {
                  const vv = verifyByKnown.get(String(k.id))?.[0];
                  const mismatch =
                    vv &&
                    String(k.entityName)
                      .replace(/[^a-z0-9]+/gi, "")
                      .toUpperCase() !==
                      String(vv.officialEntityName)
                        .replace(/[^a-z0-9]+/gi, "")
                        .toUpperCase();
                  return (
                    <tr key={String(k.id)} style={{ color: "var(--text)" }}>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{String(k.entityName)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? "yes" : "not verified"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.officialEntityName) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.state) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.status) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">
                        {mismatch ? "official-name mismatch (candidate)" : vv ? "—" : "needs follow-up"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="credit-party">
        <Card title="5. Credit-party reconciliation">
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[820px] border-collapse text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted2)" }}>
                  {["Name", "Role", "In Exhibit 21 model?", "Verified?", "SOS", "State", "Status"].map((h) => (
                    <th key={h} className="border-b border-[var(--border)] bg-[var(--card2)]/40 px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {creditRows.map((k) => {
                  const inEx = exhibitRows.some((e) => e.normalizedEntityName === k.normalizedEntityName);
                  const vv = verifyByKnown.get(String(k.id))?.[0];
                  return (
                    <tr key={String(k.id)} style={{ color: "var(--text)" }}>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{String(k.entityName)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{String(k.entityRole)}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{inEx ? "yes" : "not listed in Exhibit 21"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? "yes" : "unverified"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.officialEntityName) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.state) : "—"}</td>
                      <td className="border-b border-[var(--border)] px-2 py-1.5">{vv ? String(vv.status) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="affiliate-discovery">
        <Card title="6. Affiliate discovery (candidate affiliates)">
          <p className="mb-2 text-[10px]" style={{ color: "var(--muted2)" }}>
            {ENTITY_INTEL_AFFILIATE_NOTE}
          </p>
          <div className="overflow-x-auto rounded border border-[var(--border)]">
            <table className="w-full min-w-[960px] border-collapse text-left text-[11px]">
              <thead>
                <tr style={{ color: "var(--muted2)" }}>
                  {["Candidate", "Method", "Score", "Confidence", "Review", "Actions"].map((h) => (
                    <th key={h} className="border-b border-[var(--border)] bg-[var(--card2)]/40 px-2 py-2 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={String(c.id)} style={{ color: "var(--text)" }}>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(c.candidateEntityName)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(c.discoveryMethod)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{Math.round(Number(c.affiliationScore))}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">
                      <Badge tone="neutral">{String(c.confidence)}</Badge>
                    </td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">{String(c.reviewStatus)}</td>
                    <td className="border-b border-[var(--border)] px-2 py-1.5">
                      <div className="flex flex-wrap gap-2">
                        {(["confirm", "likely", "possible", "reject", "needs-follow-up"] as const).map((act) => (
                          <button
                            key={act}
                            type="button"
                            className="underline"
                            onClick={async () => {
                              await fetch(`${baseIntel(tk)}/candidates/${String(c.id)}/${act}`, {
                                method: "POST",
                                credentials: "same-origin",
                              });
                              void load();
                            }}
                          >
                            {act}
                          </button>
                        ))}
                        <button type="button" className="underline" onClick={() => setDrawer(c)}>
                          Evidence
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      <section id="relationship-map">
        <Card title="7. Entity relationship map (illustrative)">
          <div className="mb-3 flex flex-wrap gap-3 text-[10px]" style={{ color: "var(--muted)" }}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={showCandInGraph} onChange={(e) => setShowCandInGraph(e.target.checked)} />
              When checked: show non-rejected candidate affiliates and verified entities; when unchecked: show only verified records and confirmed affiliates.
            </label>
          </div>
          <EntityRelationshipGraph
            verified={verified}
            candidates={candidates}
            relationships={relationships}
            candidateMode={showCandInGraph ? "broad_non_rejected" : "confirmed_only"}
          />
        </Card>
      </section>

      <section id="filing-events">
        <Card title="8. Entity filing events timeline">
          <div className="space-y-2 text-[11px]">
            {events
              .slice()
              .sort((a, b) => String(b.eventDate || "").localeCompare(String(a.eventDate || "")))
              .map((ev) => (
                <div key={String(ev.id)} className="rounded border border-[var(--border)] px-2 py-2" style={{ color: "var(--text)" }}>
                  <div className="font-medium">
                    {(ev.eventDate as string)?.slice?.(0, 10) ?? "—"} · {String(ev.eventType)} · {String(ev.entityName)}
                  </div>
                  {ev.summary ? <div style={{ color: "var(--muted)" }}>{String(ev.summary)}</div> : null}
                  <div className="mt-1 flex flex-wrap gap-2">
                    {ev.documentUrl ? (
                      <a className="underline" href={String(ev.documentUrl)} target="_blank" rel="noreferrer">
                        Document link
                      </a>
                    ) : null}
                    <button type="button" className="underline" onClick={() => setDrawer(ev)}>
                      Details
                    </button>
                  </div>
                </div>
              ))}
            {events.length === 0 ? <div style={{ color: "var(--muted)" }}>No events captured yet.</div> : null}
          </div>
        </Card>
      </section>

      <section id="issues">
        <Card title="9. Issues & red flags">
          {(["critical", "high", "medium", "low"] as const).map((sev) => {
            const bucket = issues.filter((i) => String(i.severity) === sev);
            if (!bucket.length) return null;
            return (
              <div key={sev} className="mb-4">
                <h4 className="mb-2 text-[11px] font-semibold capitalize" style={{ color: "var(--text)" }}>
                  {sev}
                </h4>
                <div className="space-y-2">
                  {bucket.map((issue) => (
                    <div key={String(issue.id)} className="rounded border border-[var(--border)] px-2 py-2 text-[11px]" style={{ color: "var(--text)" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        <SevBadge severity={String(issue.severity)} />
                        <span className="font-medium">{String(issue.issueTitle)}</span>
                        <Badge tone="neutral">{String(issue.status)}</Badge>
                      </div>
                      <p className="mt-1 whitespace-pre-wrap" style={{ color: "var(--muted)" }}>
                        {String(issue.issueDescription)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="underline"
                          onClick={async () => {
                            await fetch(`${baseIntel(tk)}/issues/${String(issue.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              credentials: "same-origin",
                              body: JSON.stringify({ status: "resolved" }),
                            });
                            void load();
                          }}
                        >
                          Mark resolved
                        </button>
                        <button
                          type="button"
                          className="underline"
                          onClick={async () => {
                            await fetch(`${baseIntel(tk)}/issues/${String(issue.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              credentials: "same-origin",
                              body: JSON.stringify({ status: "dismissed" }),
                            });
                            void load();
                          }}
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="underline"
                          onClick={async () => {
                            await fetch(`${baseIntel(tk)}/issues/${String(issue.id)}`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              credentials: "same-origin",
                              body: JSON.stringify({ status: "needs_follow_up" }),
                            });
                            void load();
                          }}
                        >
                          Needs follow-up
                        </button>
                        <button type="button" className="underline" onClick={() => setDrawer(issue)}>
                          Evidence
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          {issues.length === 0 ? <p style={{ color: "var(--muted)" }} className="text-[11px]">No issues yet — run regenerate after verification work.</p> : null}
        </Card>
      </section>

      <section id="export">
        <Card title="10. Export / memo output">
          <p className="mb-2 text-[11px]" style={{ color: "var(--muted)" }}>
            Exports markdown memo text plus reconciliation CSV fragments inside JSON. Download and split as needed locally.
          </p>
          <button
            type="button"
            className="rounded border border-[var(--accent)] px-3 py-1.5 text-[11px] font-medium"
            style={{ color: "var(--text)" }}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await fetch(`${baseIntel(tk)}/export`, { method: "POST", credentials: "same-origin" });
                if (res.ok) {
                  const j = (await res.json()) as Record<string, string>;
                  const memo = typeof j.markdownMemo === "string" ? j.markdownMemo : "";
                  const blob = new Blob([memo], { type: "text/markdown" });
                  const u = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = u;
                  a.download = `${tk}-entity-memo.md`;
                  a.click();
                  URL.revokeObjectURL(u);
                }
              } finally {
                setBusy(false);
              }
            }}
          >
            Download issues memo (.md)
          </button>
        </Card>
      </section>

      {drawer ? (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/50" role="presentation" onMouseDown={() => setDrawer(null)}>
          <aside
            className="max-w-lg flex-1 overflow-y-auto bg-[var(--card)] p-4 shadow-xl"
            style={{ borderLeft: "1px solid var(--border)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex justify-between gap-2">
              <h3 className="text-[12px] font-semibold uppercase tracking-wide" style={{ color: "var(--text)" }}>
                Evidence / source drawer
              </h3>
              <button type="button" className="text-[11px] underline" style={{ color: "var(--muted)" }} onClick={() => setDrawer(null)}>
                Close
              </button>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded border border-[var(--border)] bg-[var(--card2)]/40 p-2 text-[10px]" style={{ color: "var(--text)" }}>
              {JSON.stringify(drawer, null, 2)}
            </pre>
          </aside>
        </div>
      ) : null}

      <p className="text-[10px]" style={{ color: "var(--muted2)" }}>
        {busy ? "Working…" : ""}
      </p>
    </div>
  );
}
