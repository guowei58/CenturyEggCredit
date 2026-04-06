"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, DataTable, MetricTile, TabBar } from "@/components/ui";
import type { EnvRiskSnapshot } from "@/lib/env-risk/types";

type GetOk = {
  ok: true;
  ticker: string;
  snapshot: EnvRiskSnapshot;
  cache_ttl_ms: number;
  age_ms: number | null;
  stale: boolean;
};

type GetEmpty = { ok: false; ticker?: string; error: string };

const SECTIONS = [
  { id: "overview", label: "Overview" },
  { id: "filings", label: "Filings & Disclosures" },
  { id: "facilities", label: "Facilities" },
  { id: "compliance", label: "Compliance / Enforcement" },
  { id: "emissions", label: "Emissions / Releases" },
  { id: "waste", label: "Waste / Cleanup" },
  { id: "state", label: "State Follow-Up" },
  { id: "scoring", label: "Risk Scoring" },
  { id: "sources", label: "Source Documents" },
] as const;

type SectionId = (typeof SECTIONS)[number]["id"];

function scoreColor(score: number): string | undefined {
  if (score >= 70) return "var(--danger, #c44)";
  if (score >= 45) return "var(--warn, #b8860b)";
  return undefined;
}

export function CompanyEnvironmentalClaimsTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName?: string | null;
}) {
  const safe = ticker?.trim() ?? "";
  const [section, setSection] = useState<SectionId>("overview");
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<GetOk | null>(null);
  const [overrideId, setOverrideId] = useState("");
  const [overrideMsg, setOverrideMsg] = useState<string | null>(null);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!safe) return;
    if (!opts?.silent) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/env-risk/${encodeURIComponent(safe)}`);
      const body = (await res.json()) as GetOk | GetEmpty;
      if (!res.ok || body.ok !== true) {
        setPayload(null);
        setError((body as GetEmpty).error || `HTTP ${res.status}`);
        return;
      }
      setPayload(body);
    } catch (e) {
      setPayload(null);
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!opts?.silent) setLoading(false);
    }
  }, [safe]);

  useEffect(() => {
    void load();
  }, [load]);

  const runPipeline = async (force: boolean) => {
    if (!safe) return;
    setRunning(true);
    setError(null);
    setOverrideMsg(null);
    try {
      const res = await fetch(`/api/env-risk/${encodeURIComponent(safe)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; snapshot?: EnvRiskSnapshot };
      if (!res.ok || body.ok !== true || !body.snapshot) {
        setError(body.error || `Run failed (${res.status})`);
        return;
      }
      await load({ silent: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const postOverride = async (status: "confirmed" | "rejected") => {
    if (!safe || !overrideId.trim()) return;
    setOverrideMsg(null);
    try {
      const res = await fetch(`/api/env-risk/${encodeURIComponent(safe)}/overrides`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registry_id: overrideId.trim(), status }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; note?: string };
      if (!res.ok || body.ok !== true) {
        setOverrideMsg(body.error || "Override failed");
        return;
      }
      setOverrideMsg(body.note || "Saved. Run refresh (force) to apply.");
    } catch (e) {
      setOverrideMsg(e instanceof Error ? e.message : "Override failed");
    }
  };

  if (!safe) {
    return (
      <Card title="Environmental Risk">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to run the environmental risk workflow.
        </p>
      </Card>
    );
  }

  const snap = payload?.snapshot;
  const label = companyName && companyName.toUpperCase() !== safe ? `${companyName} (${safe})` : safe;

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <Card title="Environmental Risk">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            {label} — federal-first workflow (SEC + EPA ECHO / Envirofacts FRS).
          </p>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button
              type="button"
              className="btn-institutional text-xs px-3 py-1.5"
              disabled={loading || running}
              onClick={() => void load()}
            >
              Reload cache
            </button>
            <button
              type="button"
              className="btn-institutional text-xs px-3 py-1.5"
              disabled={running}
              onClick={() => void runPipeline(false)}
            >
              {running ? "Running…" : "Run / refresh"}
            </button>
            <button
              type="button"
              className="btn-institutional text-xs px-3 py-1.5"
              disabled={running}
              onClick={() => void runPipeline(true)}
            >
              Force full rebuild
            </button>
          </div>
        </div>
        <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--muted2)" }}>
          Investor-style environmental liability and compliance workflow (not an ESG scorecard). Pulls recent 10-K / 10-Q /
          8-K text, builds an entity alias list, queries EPA FRS and ECHO, then scores and narrates. State agencies are
          stubbed for follow-up only in v1.
        </p>
        {error && (
          <p className="text-sm mb-3 rounded px-3 py-2" style={{ background: "var(--panel2)", color: "var(--danger, #c44)" }}>
            {error}
          </p>
        )}
        {payload && (
          <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
            Cache age:{" "}
            {payload.age_ms != null ? `${Math.round(payload.age_ms / 3600000)}h` : "—"} · TTL{" "}
            {Math.round(payload.cache_ttl_ms / 3600000)}h · {payload.stale ? "stale" : "fresh"}
          </p>
        )}
        <TabBar tabs={SECTIONS} activeId={section} onSelect={setSection} variant="company" />
      </Card>

      {loading && !snap && (
        <Card>
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Loading…
          </p>
        </Card>
      )}

      {!snap && !loading && error && (
        <Card title="No run yet">
          <p className="text-sm mb-4" style={{ color: "var(--muted2)" }}>
            Execute the pipeline to create the first snapshot (may take 1–3 minutes while SEC and EPA respond).
          </p>
          <button type="button" className="btn-institutional text-sm px-4 py-2" disabled={running} onClick={() => void runPipeline(true)}>
            {running ? "Running…" : "Run environmental risk pipeline"}
          </button>
        </Card>
      )}

      {snap && section === "overview" && <OverviewSection snap={snap} />}
      {snap && section === "filings" && <FilingsSection snap={snap} />}
      {snap && section === "facilities" && (
        <FacilitiesSection snap={snap} overrideId={overrideId} setOverrideId={setOverrideId} postOverride={postOverride} overrideMsg={overrideMsg} />
      )}
      {snap && section === "compliance" && <ComplianceSection snap={snap} />}
      {snap && section === "emissions" && <EmissionsSection snap={snap} />}
      {snap && section === "waste" && <WasteSection snap={snap} />}
      {snap && section === "state" && <StateSection snap={snap} />}
      {snap && section === "scoring" && <ScoringSection snap={snap} />}
      {snap && section === "sources" && <SourcesSection snap={snap} />}
    </div>
  );
}

function OverviewSection({ snap }: { snap: EnvRiskSnapshot }) {
  const s = snap.scores;
  return (
    <div className="flex flex-col gap-3">
      <Card title="Overview — scores">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <MetricTile label="Overall environmental risk" value={s.overall_environmental_risk} valueColor={scoreColor(s.overall_environmental_risk)} />
          <MetricTile label="Disclosure risk" value={s.disclosure_risk} valueColor={scoreColor(s.disclosure_risk)} />
          <MetricTile label="Compliance risk" value={s.compliance_risk} valueColor={scoreColor(s.compliance_risk)} />
          <MetricTile label="Enforcement risk" value={s.enforcement_risk} valueColor={scoreColor(s.enforcement_risk)} />
          <MetricTile label="Emissions / releases" value={s.emissions_release_risk} valueColor={scoreColor(s.emissions_release_risk)} />
          <MetricTile label="Waste / cleanup" value={s.waste_cleanup_risk} valueColor={scoreColor(s.waste_cleanup_risk)} />
          <MetricTile label="Permit / operational" value={s.permit_operational_risk} valueColor={scoreColor(s.permit_operational_risk)} />
          <MetricTile label="Data confidence" value={s.data_confidence} subtitle="Higher = more trust in linkage" />
        </div>
        <ul className="text-sm list-disc pl-5 space-y-1" style={{ color: "var(--muted2)" }}>
          {s.rationale.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
      </Card>

      <Card title="Memo — bottom line">
        <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--text)" }}>
          {snap.narrative.bottom_line}
        </p>
      </Card>

      <Card title="Key findings">
        <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Top risks (heuristic)
        </h4>
        <ul className="text-sm space-y-2 mb-4">
          {snap.hotspots.slice(0, 5).map((h, i) => (
            <li key={i} style={{ color: "var(--muted2)" }}>
              <span className="font-medium" style={{ color: "var(--text)" }}>
                {h.risk_area}
              </span>{" "}
              ({h.severity}) — {h.evidence.slice(0, 220)}
              {h.evidence.length > 220 ? "…" : ""}
            </li>
          ))}
        </ul>
        <h4 className="text-xs font-semibold mb-2 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
          Monitoring deltas (vs last cached snapshot)
        </h4>
        <ul className="text-sm list-disc pl-5" style={{ color: "var(--muted2)" }}>
          {snap.monitoring.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </Card>

      <Card title="Narrative — full analyst memo">
        {(
          [
            ["What the company discloses", snap.narrative.what_company_discloses],
            ["What the regulatory data shows", snap.narrative.what_regulatory_data_shows],
            ["Where the main risk sits", snap.narrative.where_main_risk_sits],
            ["Hidden liabilities / capex", snap.narrative.hidden_liabilities_capex],
            ["Facilities / states to monitor", snap.narrative.facilities_states_to_monitor],
            ["What looks benign", snap.narrative.benign_or_low_risk],
            ["Open questions", snap.narrative.open_questions],
          ] as const
        ).map(([title, text]) => (
          <div key={title} className="mb-4 last:mb-0">
            <h4 className="text-xs font-semibold mb-1 uppercase tracking-wide" style={{ color: "var(--muted)" }}>
              {title}
            </h4>
            <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
              {text}
            </p>
          </div>
        ))}
      </Card>
    </div>
  );
}

function whyDisclosureMatters(topic: string): string {
  const map: Record<string, string> = {
    environmental_liability: "Ties to balance sheet / contingencies / ongoing spend.",
    remediation_reserve: "Accrual changes can move earnings and cash.",
    aro: "ARO can be large for industrial, mining, or midstream assets.",
    legal_environmental: "Litigation or agency orders can drive fines and capex.",
    permitting: "Permit limits affect throughput and expansion.",
    emissions_climate: "Policy, litigation, and transition/physical risk narrative.",
    water_waste: "Operational disruption, compliance cost, reputational risk.",
    capex_environmental: "Future cash needs and project risk.",
    superfund_cercla: "Joint & several liability; potentially uncapped.",
    rcra_hazwaste: "Hazardous waste compliance and corrective action.",
    pfas: "Emerging liability and regulatory tightening.",
    asbestos: "Legacy exposure and abatement costs.",
    groundwater: "Plume cleanup and third-party claims.",
    spill_release: "Acute incidents and enforcement.",
    other: "Review context — may still be material.",
  };
  return map[topic] || map.other;
}

function FilingsSection({ snap }: { snap: EnvRiskSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      <Card title="Cross-period (10-K sample)">
        {snap.cross_period.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Need at least two 10-K extractions in the sample to compare.
          </p>
        ) : (
          <ul className="text-sm space-y-2">
            {snap.cross_period.map((c, i) => (
              <li key={i} style={{ color: "var(--muted2)" }}>
                <span className="font-medium" style={{ color: "var(--text)" }}>
                  {c.kind}
                </span>{" "}
                — {c.description}
                <div className="text-xs mt-1" style={{ color: "var(--muted)" }}>
                  {c.evidence}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Disclosure excerpts">
        <DataTable>
          <thead>
            <tr>
              <th>Filing date</th>
              <th>Document</th>
              <th>Topic</th>
              <th>Extracted issue</th>
              <th>Amount</th>
              <th>Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {snap.disclosure_rows.slice(0, 80).map((d, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap text-xs">{d.filing_date}</td>
                <td className="text-xs max-w-[8rem]">{d.source_document}</td>
                <td className="text-xs">{d.topic}</td>
                <td className="text-xs max-w-md">{d.extracted_text.slice(0, 280)}{d.extracted_text.length > 280 ? "…" : ""}</td>
                <td className="text-xs whitespace-nowrap">{d.extracted_amount ?? "—"}</td>
                <td className="text-xs max-w-[14rem]" style={{ color: "var(--muted2)" }}>
                  {whyDisclosureMatters(d.topic)}
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}

function FacilitiesSection({
  snap,
  overrideId,
  setOverrideId,
  postOverride,
  overrideMsg,
}: {
  snap: EnvRiskSnapshot;
  overrideId: string;
  setOverrideId: (s: string) => void;
  postOverride: (s: "confirmed" | "rejected") => void;
  overrideMsg: string | null;
}) {
  return (
    <Card title="Facilities (federal merge)">
      <p className="text-sm mb-3" style={{ color: "var(--muted2)" }}>
        Registry IDs link to EPA ECHO detailed facility reports. Matches use parent/subsidiary names — always verify operator
        legal names.
      </p>
      <div className="flex flex-wrap gap-2 items-end mb-4">
        <label className="flex flex-col text-xs gap-1" style={{ color: "var(--muted)" }}>
          Registry ID override
          <input
            className="px-2 py-1 rounded border text-sm"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
            value={overrideId}
            onChange={(e) => setOverrideId(e.target.value)}
            placeholder="EPA registry / FRS ID"
          />
        </label>
        <button type="button" className="btn-institutional text-xs px-3 py-1.5" onClick={() => postOverride("confirmed")}>
          Confirm match
        </button>
        <button type="button" className="btn-institutional text-xs px-3 py-1.5" onClick={() => postOverride("rejected")}>
          Reject match
        </button>
      </div>
      {overrideMsg && (
        <p className="text-xs mb-3" style={{ color: "var(--muted2)" }}>
          {overrideMsg}
        </p>
      )}
      <DataTable>
        <thead>
          <tr>
            <th>Facility</th>
            <th>State</th>
            <th>Segment</th>
            <th>Matched entity</th>
            <th>Confidence</th>
            <th>Compliance</th>
            <th>Enforcement</th>
            <th>Emissions / release</th>
            <th>Waste / cleanup</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {snap.facilities.map((f) => (
            <tr key={f.id}>
              <td className="text-xs max-w-xs">{f.facility_name}</td>
              <td className="text-xs whitespace-nowrap">{f.state ?? "—"}</td>
              <td className="text-xs">{f.business_segment ?? "—"}</td>
              <td className="text-xs max-w-[7rem]">{f.matched_entity.slice(0, 40)}</td>
              <td className="text-xs whitespace-nowrap">{f.match_confidence}</td>
              <td className="text-xs max-w-[10rem]">{f.compliance_flags.join("; ") || "—"}</td>
              <td className="text-xs max-w-[10rem]">{f.enforcement_flags.join("; ") || "—"}</td>
              <td className="text-xs max-w-[10rem]">{f.emissions_flags.join("; ") || "—"}</td>
              <td className="text-xs max-w-[10rem]">{f.waste_flags.join("; ") || "—"}</td>
              <td className="text-xs whitespace-nowrap">
                {f.echo_detail_url ? (
                  <a href={f.echo_detail_url} target="_blank" rel="noreferrer" className="underline">
                    ECHO
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Card>
  );
}

function ComplianceSection({ snap }: { snap: EnvRiskSnapshot }) {
  const rows = snap.facilities.filter((f) => f.compliance_flags.length + f.enforcement_flags.length > 0);
  return (
    <Card title="Compliance / enforcement detail">
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No compliance/enforcement strings on merged ECHO rows in this run.
        </p>
      ) : (
        <ul className="text-sm space-y-3">
          {rows.map((f) => (
            <li key={f.id} style={{ color: "var(--muted2)" }}>
              <div className="font-medium" style={{ color: "var(--text)" }}>
                {f.facility_name}{" "}
                <span className="text-xs font-normal" style={{ color: "var(--muted)" }}>
                  ({f.state})
                </span>
              </div>
              <div>Compliance: {f.compliance_flags.join("; ") || "—"}</div>
              <div>Enforcement: {f.enforcement_flags.join("; ") || "—"}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function EmissionsSection({ snap }: { snap: EnvRiskSnapshot }) {
  const rows = snap.facilities.filter((f) => f.emissions_flags.length > 0);
  return (
    <Card title="Emissions / TRI / air flags (ECHO-derived)">
      <p className="text-xs mb-3" style={{ color: "var(--muted)" }}>
        v1 uses ECHO all-media row fields (TRI / CAA flags). Dedicated TRI quantity trends require additional EPA tables.
      </p>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No TRI/air flags on merged facilities.
        </p>
      ) : (
        <ul className="text-sm space-y-2">
          {rows.map((f) => (
            <li key={f.id} style={{ color: "var(--muted2)" }}>
              <strong style={{ color: "var(--text)" }}>{f.facility_name}</strong>: {f.emissions_flags.join("; ")}
            </li>
          ))}
        </ul>
      )}
      <h4 className="text-xs font-semibold mt-4 mb-2 uppercase" style={{ color: "var(--muted)" }}>
        Trend — filings with env hits by year
      </h4>
      <TrendBars data={snap.trends.filings_with_env_hits_by_year} />
    </Card>
  );
}

function WasteSection({ snap }: { snap: EnvRiskSnapshot }) {
  const rows = snap.facilities.filter((f) => f.waste_flags.length > 0);
  return (
    <Card title="Waste / RCRA signals">
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No RCRA-oriented strings on merged ECHO rows.
        </p>
      ) : (
        <ul className="text-sm space-y-2">
          {rows.map((f) => (
            <li key={f.id} style={{ color: "var(--muted2)" }}>
              <strong style={{ color: "var(--text)" }}>{f.facility_name}</strong>: {f.waste_flags.join("; ")}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function StateSection({ snap }: { snap: EnvRiskSnapshot }) {
  return (
    <Card title="State follow-up (heuristic)">
      <p className="text-sm mb-4" style={{ color: "var(--muted2)" }}>
        Pluggable <code className="text-xs">stateAgencyService</code> interface — v1 lists states to prioritize for manual
        state-portal review.
      </p>
      <DataTable>
        <thead>
          <tr>
            <th>State</th>
            <th>Facilities</th>
            <th>Priority</th>
            <th>Rationale</th>
            <th>Future</th>
          </tr>
        </thead>
        <tbody>
          {snap.state_follow_up.map((r, i) => (
            <tr key={i}>
              <td className="text-xs">{r.state}</td>
              <td className="text-xs">{r.facility_count}</td>
              <td className="text-xs">{r.priority}</td>
              <td className="text-xs max-w-lg">{r.rationale}</td>
              <td className="text-xs">{r.future_connector}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Card>
  );
}

function ScoringSection({ snap }: { snap: EnvRiskSnapshot }) {
  return (
    <Card title="Risk scoring — transparent components">
      <p className="text-sm mb-4" style={{ color: "var(--muted2)" }}>
        Sub-scores are heuristics from disclosure counts, ECHO compliance strings, enforcement strings, program flags, and
        facility counts — not a third-party ESG rating.
      </p>
      <DataTable>
        <thead>
          <tr>
            <th>Component</th>
            <th>Value (0–100)</th>
          </tr>
        </thead>
        <tbody>
          {(
            [
              ["Overall", snap.scores.overall_environmental_risk],
              ["Disclosure", snap.scores.disclosure_risk],
              ["Compliance", snap.scores.compliance_risk],
              ["Enforcement", snap.scores.enforcement_risk],
              ["Emissions / releases", snap.scores.emissions_release_risk],
              ["Waste / cleanup", snap.scores.waste_cleanup_risk],
              ["Permit / operational", snap.scores.permit_operational_risk],
              ["Data confidence", snap.scores.data_confidence],
            ] as const
          ).map(([k, v]) => (
            <tr key={k}>
              <td className="text-xs">{k}</td>
              <td className="text-xs font-medium">{v}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
      <h4 className="text-xs font-semibold mt-6 mb-2 uppercase" style={{ color: "var(--muted)" }}>
        Risk hotspot table
      </h4>
      <DataTable>
        <thead>
          <tr>
            <th>Area</th>
            <th>Evidence</th>
            <th>Entities</th>
            <th>Severity</th>
            <th>Monitor</th>
          </tr>
        </thead>
        <tbody>
          {snap.hotspots.map((h, i) => (
            <tr key={i}>
              <td className="text-xs">{h.risk_area}</td>
              <td className="text-xs max-w-sm">{h.evidence.slice(0, 160)}…</td>
              <td className="text-xs">{h.affected_facilities_or_entities}</td>
              <td className="text-xs">{h.severity}</td>
              <td className="text-xs max-w-sm">{h.what_to_monitor}</td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </Card>
  );
}

function SourcesSection({ snap }: { snap: EnvRiskSnapshot }) {
  return (
    <div className="flex flex-col gap-3">
      <Card title="Source documents & data lineage">
        <ul className="text-sm space-y-2">
          {snap.sources.map((s, i) => (
            <li key={i} style={{ color: "var(--muted2)" }}>
              <span className="font-medium" style={{ color: "var(--text)" }}>
                [{s.source_type}]
              </span>{" "}
              {s.label}
              {s.url && (
                <>
                  {" "}
                  —{" "}
                  <a href={s.url} target="_blank" rel="noreferrer" className="underline">
                    link
                  </a>
                </>
              )}
              <span className="text-xs block" style={{ color: "var(--muted)" }}>
                Retrieved {s.retrieved_at_iso}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Pipeline notes & errors">
        {snap.errors.length > 0 && (
          <ul className="text-sm list-disc pl-5 mb-4" style={{ color: "var(--danger, #c44)" }}>
            {snap.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        )}
        <ul className="text-sm list-disc pl-5" style={{ color: "var(--muted2)" }}>
          {snap.pipeline_notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
        <p className="text-xs mt-4" style={{ color: "var(--muted)" }}>
          Feature flags: ECHO {String(snap.config_flags.echo)} · Envirofacts {String(snap.config_flags.envirofacts)} · RCRA
          (ECHO fields) {String(snap.config_flags.rcra)} · State connectors {String(snap.config_flags.state_connectors)}
        </p>
      </Card>
    </div>
  );
}

function TrendBars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b));
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (entries.length === 0) return <p className="text-xs" style={{ color: "var(--muted2)" }}>No year buckets yet.</p>;
  return (
    <div className="space-y-2">
      {entries.map(([y, v]) => (
        <div key={y} className="flex items-center gap-2 text-xs">
          <span className="w-10 shrink-0" style={{ color: "var(--muted)" }}>
            {y}
          </span>
          <div className="flex-1 h-2 rounded overflow-hidden" style={{ background: "var(--border)" }}>
            <div
              className="h-full rounded"
              style={{ width: `${(v / max) * 100}%`, background: "var(--accent, #3a6ea5)" }}
            />
          </div>
          <span className="w-6 text-right" style={{ color: "var(--muted2)" }}>
            {v}
          </span>
        </div>
      ))}
    </div>
  );
}
