"use client";

import { ENTITY_UNIVERSE_UCC_NOTE } from "@/components/entityUniverse/entityUniverseCopy";

type Row = Record<string, unknown>;

function asStrArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === "string" && x.trim()) as string[];
}

const SOURCE_LABELS: Record<string, string> = {
  exhibit21_profile: "Exhibit 21 (profile)",
  exhibit21_synced: "Exhibit 21 (synced)",
  sos_name_family: "SOS name-family",
  address_cluster: "Address cluster",
  user_added: "User added",
};

function formatSources(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "—";
  return s
    .split(";")
    .map((x) => SOURCE_LABELS[x.trim()] ?? x.trim())
    .filter(Boolean)
    .join(", ");
}

function fmtJsonCell(v: unknown): string {
  if (v == null) return "—";
  if (typeof v === "string") return v || "—";
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

function sourceMixSummary(r: Row): string {
  const parts: string[] = [];
  const n = (k: keyof Row) => Number(r[k] ?? 0);
  if (n("exhibit21Count")) parts.push(`Ex21 ${n("exhibit21Count")}`);
  if (n("sosCount")) parts.push(`SOS ${n("sosCount")}`);
  if (n("addressClusterCount")) parts.push(`Addr ${n("addressClusterCount")}`);
  if (n("userAddedCount")) parts.push(`User ${n("userAddedCount")}`);
  return parts.length ? parts.join(" · ") : "—";
}

const tableShell =
  "w-full border-collapse text-left text-[12px] text-[var(--text)]";

const subHeading =
  "text-[10px] font-semibold uppercase tracking-wide text-[var(--muted2)] mt-4 mb-1";

export function EntityUniverseUccWorkflowPanel({
  ticker,
  loadError,
  busy,
  uccBusy,
  nationalSweep,
  setNationalSweep,
  broadNameFamily,
  setBroadNameFamily,
  msg,
  onRun,
  stateAggregation,
  candidates,
  searchResults,
  manualTasks,
  creditMatches,
  discovered,
}: {
  ticker: string;
  loadError: string | null;
  busy: boolean;
  uccBusy: boolean;
  nationalSweep: boolean;
  setNationalSweep: (v: boolean) => void;
  broadNameFamily: boolean;
  setBroadNameFamily: (v: boolean) => void;
  msg: string | null;
  onRun: () => void;
  stateAggregation: Row[];
  candidates: Row[];
  searchResults: Row[];
  manualTasks: Row[];
  creditMatches: Row[];
  discovered: Row[];
}) {
  const tk = ticker.trim().toUpperCase();

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-[var(--muted)]">{ENTITY_UNIVERSE_UCC_NOTE}</p>
      {loadError ? (
        <p className="rounded border border-[var(--danger)]/40 bg-[var(--danger)]/10 px-2 py-1.5 text-[11px] text-[var(--danger)]">
          {loadError}
        </p>
      ) : null}

      <div className="flex flex-col gap-2 text-[11px] text-[var(--muted)]">
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={nationalSweep}
            disabled={uccBusy || busy || !tk}
            onChange={(e) => setNationalSweep(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          National jurisdiction sweep (every US state as secondary — very large queue)
        </label>
        <label className="flex cursor-pointer items-center gap-2">
          <input
            type="checkbox"
            checked={broadNameFamily}
            disabled={uccBusy || busy || !tk}
            onChange={(e) => setBroadNameFamily(e.target.checked)}
            className="accent-[var(--accent)]"
          />
          Broad name-family variants (last resort — increases false positives)
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={uccBusy || busy || !tk}
          className="rounded border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
        >
          {uccBusy ? "Running workflow…" : "Run UCC Debtor Search"}
        </button>
        <span className="text-[10px] text-[var(--muted2)]">
          Wipes prior UCC workflow rows for this ticker; rebuilds state buckets (registry), queues, and mapper evidence merge when results exist.
        </span>
        {msg ? (
          <span className="text-[11px]" style={{ color: msg.includes("failed") ? "var(--danger)" : "var(--muted2)" }}>
            {msg}
          </span>
        ) : null}
      </div>

      <h5 className={subHeading}>1 · State aggregation summary</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">State</th>
              <th className="py-1 pr-2">Entities</th>
              <th className="py-1 pr-2">Source mix</th>
              <th className="py-1 pr-2">Exact jur.</th>
              <th className="py-1 pr-2">Inferred</th>
              <th className="py-1 pr-2">Unknown jur.</th>
              <th className="py-1 pr-2">Bucket</th>
              <th className="py-1 pr-2">Search method</th>
              <th className="py-1 pr-2">Adapter</th>
              <th className="py-1 pr-2">Manual?</th>
              <th className="py-1 pr-2">Progress</th>
              <th className="py-1 pr-2">Hits</th>
            </tr>
          </thead>
          <tbody>
            {stateAggregation.length === 0 ? (
              <tr>
                <td className="py-2 text-[var(--muted)]" colSpan={12}>
                  Run the workflow to aggregate subsidiary workloads by filing jurisdiction.
                </td>
              </tr>
            ) : (
              stateAggregation.map((r) => (
                <tr key={String(r.state)} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {String(r.state)}{" "}
                    <span className="text-[10px] text-[var(--muted2)]">({String(r.stateDisplay)})</span>
                  </td>
                  <td className="py-1 pr-2">{String(r.entityCount ?? 0)}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">{sourceMixSummary(r)}</td>
                  <td className="py-1 pr-2">{String(r.exactJurisdictionCount ?? 0)}</td>
                  <td className="py-1 pr-2">{String(r.inferredJurisdictionCount ?? 0)}</td>
                  <td className="py-1 pr-2">{String(r.unknownJurisdictionCount ?? 0)}</td>
                  <td className="py-1 pr-2 whitespace-nowrap text-[10px]">
                    {String(r.automationBucketLetter ?? "—")}/{String(r.automationBucketKey ?? "").replace(/_/g, " ")}
                  </td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap text-[10px]">{String(r.recommendedSearchMethod ?? "—")}</td>
                  <td className="py-1 pr-2 text-[10px]">{String(r.adapterStatus ?? "—").replace(/_/g, " ")}</td>
                  <td className="py-1 pr-2">{r.manualRequired ? "yes" : "—"}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">{String(r.searchProgress ?? "—")}</td>
                  <td className="py-1 pr-2">{String(r.hits ?? 0)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h5 className={subHeading}>2 · Entity search queue</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">Entity</th>
              <th className="py-1 pr-2">Sources</th>
              <th className="py-1 pr-2">Jurisdiction Δ</th>
              <th className="py-1 pr-2">Primary</th>
              <th className="py-1 pr-2">Bucket</th>
              <th className="py-1 pr-2">Method</th>
              <th className="py-1 pr-2">Queries</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">Hits</th>
              <th className="py-1 pr-2">Confidence</th>
              <th className="py-1 pr-2">Portal</th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((r) => (
              <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                <td className="py-1 pr-2 max-w-[170px] whitespace-pre-wrap">{String(r.debtorName ?? "")}</td>
                <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">{formatSources(r.workflowEntitySources)}</td>
                <td className="py-1 pr-2 text-[10px]">{String(r.jurisdictionConfidenceKind ?? "—")}</td>
                <td className="py-1 pr-2 whitespace-nowrap">{String(r.state ?? "")}</td>
                <td className="py-1 pr-2 text-[10px] whitespace-pre-wrap">{String(r.automationBucket ?? "").replace(/_/g, " ") || "—"}</td>
                <td className="py-1 pr-2 max-w-[130px] whitespace-pre-wrap text-[10px]">{String(r.recommendedSearchMethod ?? "—")}</td>
                <td className="py-1 pr-2 max-w-[200px] whitespace-pre-wrap text-[10px]">
                  {asStrArr(r.queryVariantsJson).slice(0, 5).join(" · ") || String(r.matchedSearchTerm ?? "—")}
                  {asStrArr(r.queryVariantsJson).length > 5 ? "…" : ""}
                </td>
                <td className="py-1 pr-2 text-[10px]">{String(r.workflowSearchStatus ?? "—")}</td>
                <td className="py-1 pr-2">{String(r.workflowHitCount ?? 0)}</td>
                <td className="py-1 pr-2">{String(r.confidence ?? "—")}</td>
                <td className="py-1 pr-2">
                  {r.sourceUrl ? (
                    <a
                      href={String(r.sourceUrl)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent)] underline underline-offset-2"
                    >
                      Open
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h5 className={subHeading}>3 · UCC search results</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">Entity searched</th>
              <th className="py-1 pr-2">State</th>
              <th className="py-1 pr-2">Debtor found</th>
              <th className="py-1 pr-2">Secured party</th>
              <th className="py-1 pr-2">Filing #</th>
              <th className="py-1 pr-2">Type</th>
              <th className="py-1 pr-2">Filed</th>
              <th className="py-1 pr-2">Status</th>
              <th className="py-1 pr-2">Collateral?</th>
              <th className="py-1 pr-2">Source</th>
              <th className="py-1 pr-2">Doc link</th>
              <th className="py-1 pr-2">Likely role</th>
              <th className="py-1 pr-2">Confidence</th>
              <th className="py-1 pr-2">Notes</th>
            </tr>
          </thead>
          <tbody>
            {searchResults.length === 0 ? (
              <tr>
                <td className="py-2 text-[var(--muted)]" colSpan={14}>
                  No stored results yet — ingest bulk/API rows, finish manual captures, or upload parsed filings.
                </td>
              </tr>
            ) : (
              searchResults.map((r) => (
                <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap">{String(r.entitySearched ?? "")}</td>
                  <td className="py-1 pr-2">{String(r.jurisdiction ?? "")}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap">{String(r.debtorNameFound ?? "")}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap">{String(r.securedPartyName ?? "—")}</td>
                  <td className="py-1 pr-2">{String(r.filingNumber ?? "—")}</td>
                  <td className="py-1 pr-2">{String(r.filingType ?? "").replace(/_/g, " ")}</td>
                  <td className="py-1 pr-2">{String(r.filingDate ?? "—").slice(0, 10)}</td>
                  <td className="py-1 pr-2">{String(r.filingStatus ?? "—")}</td>
                  <td className="py-1 pr-2">{r.collateralDescriptionAvailable ? "yes" : "—"}</td>
                  <td className="py-1 pr-2 text-[10px]">{String(r.sourceMethod ?? "—").replace(/_/g, " ")}</td>
                  <td className="py-1 pr-2">
                    {r.documentLink ? (
                      <a
                        href={String(r.documentLink)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] underline underline-offset-2"
                      >
                        Link
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap text-[10px]">
                    {String(r.likelyFinancingRelationship ?? "—").replace(/_/g, " ")}
                  </td>
                  <td className="py-1 pr-2">{String(r.confidence ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[200px] whitespace-pre-wrap text-[10px]">{String(r.notes ?? "—")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h5 className={subHeading}>4 · UCC → credit document match</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">UCC debtor</th>
              <th className="py-1 pr-2">Secured party</th>
              <th className="py-1 pr-2">Matched agent/trustee</th>
              <th className="py-1 pr-2">Instrument</th>
              <th className="py-1 pr-2">Filing vs doc date</th>
              <th className="py-1 pr-2">Likely role</th>
              <th className="py-1 pr-2">Evidence</th>
              <th className="py-1 pr-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {creditMatches.length === 0 ? (
              <tr>
                <td className="py-2 text-[var(--muted)]" colSpan={8}>
                  No matches recorded yet — matching runs when structured UCC results reference secured parties.
                </td>
              </tr>
            ) : (
              creditMatches.map((r) => (
                <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap">{String(r.uccDebtorName ?? "")}</td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap">{String(r.securedPartyName ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap">{String(r.matchedCreditPartyName ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">
                    {String(r.matchedFacilityInstrument ?? "—")}
                  </td>
                  <td className="py-1 pr-2 text-[10px] whitespace-pre-wrap">
                    {String(r.filingDate ?? "—").slice(0, 10)} / {String(r.documentDate ?? "—").slice(0, 10)}
                  </td>
                  <td className="py-1 pr-2">{String(r.likelyRole ?? "—").replace(/_/g, " ")}</td>
                  <td className="py-1 pr-2 max-w-[220px] whitespace-pre-wrap text-[10px]">{fmtJsonCell(r.sourceEvidence)}</td>
                  <td className="py-1 pr-2">{String(r.confidence ?? "—")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h5 className={subHeading}>5 · Manual search queue</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">Entity</th>
              <th className="py-1 pr-2">State</th>
              <th className="py-1 pr-2">Bucket</th>
              <th className="py-1 pr-2">Workflow</th>
              <th className="py-1 pr-2">DE auth?</th>
              <th className="py-1 pr-2">Portal</th>
              <th className="py-1 pr-2">Exact query</th>
              <th className="py-1 pr-2">Variants</th>
              <th className="py-1 pr-2">Why manual</th>
              <th className="py-1 pr-2">Task</th>
              <th className="py-1 pr-2">Notes</th>
              <th className="py-1 pr-2">Upload</th>
              <th className="py-1 pr-2">Complete</th>
            </tr>
          </thead>
          <tbody>
            {manualTasks.length === 0 ? (
              <tr>
                <td className="py-2 text-[var(--muted)]" colSpan={13}>
                  Run the workflow to populate portal tasks.
                </td>
              </tr>
            ) : (
              manualTasks.map((r) => (
                <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-1 pr-2 max-w-[150px] whitespace-pre-wrap">{String(r.entityName ?? "")}</td>
                  <td className="py-1 pr-2">{String(r.jurisdiction ?? "")}</td>
                  <td className="py-1 pr-2 text-[10px]">{String(r.automationBucket ?? "").replace(/_/g, " ") || "—"}</td>
                  <td className="py-1 pr-2 text-[10px]">{String(r.workflowStatusLabel ?? "—")}</td>
                  <td className="py-1 pr-2">{r.isDelawareAuthorizedSearcherTask ? "yes" : "—"}</td>
                  <td className="py-1 pr-2">
                    {r.portalUrl ? (
                      <a
                        href={String(r.portalUrl)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--accent)] underline underline-offset-2"
                      >
                        Open
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap text-[10px]">{String(r.exactSearchQuery ?? "")}</td>
                  <td className="py-1 pr-2 max-w-[180px] whitespace-pre-wrap text-[10px]">
                    {asStrArr(r.normalizedQueriesJson).slice(0, 4).join(" · ") || "—"}
                  </td>
                  <td className="py-1 pr-2 max-w-[200px] whitespace-pre-wrap text-[10px]">{String(r.reasonManual ?? "")}</td>
                  <td className="py-1 pr-2 text-[10px]">{String(r.taskStatus ?? "").replace(/_/g, " ")}</td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap text-[10px]">{String(r.notes ?? "—")}</td>
                  <td className="py-1 pr-2">
                    <button
                      type="button"
                      disabled
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] opacity-50"
                      title="Wire storage + parser hook"
                    >
                      Upload
                    </button>
                  </td>
                  <td className="py-1 pr-2">
                    <button type="button" disabled className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] opacity-50">
                      Mark done
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h5 className={subHeading}>6 · New entity candidates from UCC</h5>
      <div className="overflow-x-auto">
        <table className={tableShell}>
          <thead>
            <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
              <th className="py-1 pr-2">Name</th>
              <th className="py-1 pr-2">State</th>
              <th className="py-1 pr-2">Address</th>
              <th className="py-1 pr-2">Secured party</th>
              <th className="py-1 pr-2">Filing #</th>
              <th className="py-1 pr-2">Reason</th>
              <th className="py-1 pr-2">Next step</th>
              <th className="py-1 pr-2">Confidence</th>
            </tr>
          </thead>
          <tbody>
            {discovered.length === 0 ? (
              <tr>
                <td className="py-2 text-[var(--muted)]" colSpan={8}>
                  No net-new debtor leads flagged yet — populated once filings expose unfamiliar debtor names.
                </td>
              </tr>
            ) : (
              discovered.map((r) => (
                <tr key={String(r.id)} className="border-b border-[var(--border)]/60 align-top">
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap">{String(r.newEntityName ?? "")}</td>
                  <td className="py-1 pr-2">{String(r.jurisdiction ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">{String(r.debtorAddress ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[140px] whitespace-pre-wrap text-[10px]">
                    {String(r.securedPartyName ?? "—")}
                  </td>
                  <td className="py-1 pr-2">{String(r.filingNumber ?? "—")}</td>
                  <td className="py-1 pr-2 max-w-[180px] whitespace-pre-wrap text-[10px]">{String(r.reasonFlagged ?? "")}</td>
                  <td className="py-1 pr-2 max-w-[160px] whitespace-pre-wrap text-[10px]">{String(r.suggestedNextStep ?? "")}</td>
                  <td className="py-1 pr-2">{String(r.confidence ?? "—")}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
