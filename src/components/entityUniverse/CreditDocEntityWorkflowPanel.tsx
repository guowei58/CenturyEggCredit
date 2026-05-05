"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CREDIT_MATRIX_ROLE_KEYS, MATRIX_COLUMN_LABELS } from "@/lib/creditDocs/matrixRoleKeys";
import type { RoleFlagTriState } from "@/lib/creditDocs/matrixRoleKeys";

type FinderCandidate = {
  documentTitle: string;
  documentType: string;
  filingType: string;
  sourceUrl: string | null;
  savedDocumentRefId: string | null;
  extractedTextDigest: string | null;
  openUrl?: string | null;
  filingDate?: string | null;
};

function DocTitleLink({ title, href }: { title: string; href?: string | null }) {
  if (!href) return <span className="break-words">{title}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-words text-[var(--accent)] underline-offset-2 hover:underline"
    >
      {title}
    </a>
  );
}

function roleCell(sym: RoleFlagTriState | string | undefined): string {
  if (sym === "true") return "✓";
  if (sym === "needs_review") return "⚠";
  if (sym === "unknown") return "?";
  return "";
}

const INTRO_COPY =
  "This tool extracts entities from credit documents and reconciles them against Exhibit 21 and the master Entity Universe. Credit documents often identify borrowers, guarantors, grantors, pledgors, restricted subsidiaries, unrestricted subsidiaries, excluded subsidiaries, non-guarantor subsidiaries, receivables subsidiaries, securitization entities, and other entities that may not be listed in Exhibit 21.";

const WARN_COPY =
  "Entity extraction is evidence-based but requires user review. The app should not treat an extracted entity as confirmed unless the user approves it. Always preserve document title, section reference, schedule reference, page number if available, and excerpt.";

const EX21_NOTE =
  "An entity appearing in credit documents but not in Exhibit 21 is not automatically problematic. It is a diligence flag requiring review.";

const MATRIX_NOTE =
  "Each row is a unique legal entity. Each checked cell is backed by source evidence. Click a row for key evidence summary (full cell-level evidence travels with exports and API payloads).";

function wfApi(ticker: string) {
  const tk = encodeURIComponent(ticker.trim().toUpperCase());
  return `/api/companies/${tk}/credit-doc-entities`;
}

export function CreditDocEntityWorkflowPanel({ ticker }: { ticker: string }) {
  const tk = ticker.trim().toUpperCase();

  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [candidates, setCandidates] = useState<FinderCandidate[]>([]);
  /** Full EDGAR debt playbook payload (API `edgarDebtSearch`). */
  const [edgarDebtReport, setEdgarDebtReport] = useState<Record<string, unknown> | null>(null);
  const [documents, setDocuments] = useState<Record<string, unknown>[]>([]);
  const [extractions, setExtractions] = useState<Record<string, unknown>[]>([]);
  const [matrix, setMatrix] = useState<Record<string, unknown>[]>([]);
  const [evidenceOpen, setEvidenceOpen] = useState<Record<string, unknown> | null>(null);
  const [matrixSelectedIds, setMatrixSelectedIds] = useState(() => new Set<string>());

  const [issues, setIssues] = useState<Record<string, unknown>[]>([]);

  const loadAll = useCallback(async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const base = wfApi(tk);
      const [dRes, xRes, mRes, iRes] = await Promise.all([
        fetch(`${base}/documents`, { credentials: "same-origin" }),
        fetch(`${base}/extractions`, { credentials: "same-origin" }),
        fetch(`${base}/matrix`, { credentials: "same-origin" }),
        fetch(`${base}/issues`, { credentials: "same-origin" }),
      ]);
      const dJson = dRes.ok ? ((await dRes.json()) as { documents?: Record<string, unknown>[] }) : {};
      const xJson = xRes.ok ? ((await xRes.json()) as { extractions?: Record<string, unknown>[] }) : {};
      const mJson = mRes.ok ? ((await mRes.json()) as { matrix?: Record<string, unknown>[] }) : {};
      const iJson = iRes.ok ? ((await iRes.json()) as { issues?: Record<string, unknown>[] }) : {};
      setDocuments(dJson.documents ?? []);
      setExtractions(xJson.extractions ?? []);
      setMatrix(mJson.matrix ?? []);
      setIssues(iJson.issues ?? []);
    } catch {
      setMsg("Failed loading credit workflow.");
    } finally {
      setBusy(false);
    }
  }, [tk]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refsQueued = useMemo(() => {
    const s = new Set<string>();
    for (const d of documents) {
      const ref = typeof d.savedDocumentRefId === "string" ? d.savedDocumentRefId : null;
      if (ref) s.add(ref);
    }
    return s;
  }, [documents]);

  const scanSaved = async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/find-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ lookbackYears: 10 }),
      });
      const j = (await r.json()) as {
        candidates?: FinderCandidate[];
        edgarDebtSearch?: Record<string, unknown> | null;
        error?: string;
        edgarWarning?: string | null;
      };
      if (!r.ok) {
        setMsg(j.error ?? "Scan failed.");
        setCandidates([]);
        setEdgarDebtReport(null);
        return;
      }
      setCandidates(j.candidates ?? []);
      setEdgarDebtReport(j.edgarDebtSearch ?? null);
      const n = j.candidates?.length ?? 0;
      let line = `Found ${n} credit-related document(s) from EDGAR filings and your saved/workspace captures — open a title (SEC links open www.sec.gov), or add to the queue for extraction.`;
      if (j.edgarWarning) line += ` Warning: ${j.edgarWarning}`;
      setMsg(line);
    } catch {
      setEdgarDebtReport(null);
      setMsg("Scan failed.");
    } finally {
      setBusy(false);
    }
  };

  const queueCandidate = async (c: FinderCandidate) => {
    if (!tk) return;
    if (!c.savedDocumentRefId && !c.openUrl?.startsWith("https://www.sec.gov/")) return;
    setBusy(true);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        documentTitle: c.documentTitle,
        documentType: c.documentType,
        filingType: c.filingType,
        sourceUrl: c.sourceUrl ?? undefined,
        savedDocumentRefId: c.savedDocumentRefId ?? undefined,
      };
      if (c.openUrl?.startsWith("https://www.sec.gov/")) {
        payload.secUrl = c.openUrl;
      }
      if (typeof c.filingDate === "string" && c.filingDate) {
        payload.filingDate = c.filingDate;
      }
      const ref = c.savedDocumentRefId;
      if (typeof ref === "string" && ref.startsWith("edgar:")) {
        const rest = ref.slice("edgar:".length);
        const idx = rest.indexOf("::");
        if (idx > 0) payload.accessionNumber = rest.slice(0, idx);
      }

      const r = await fetch(`${wfApi(tk)}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(payload),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Could not queue document.");
        return;
      }
      await loadAll();
      setMsg("Document added to queue.");
    } finally {
      setBusy(false);
    }
  };

  const processDoc = async (id: string) => {
    if (!tk || !id) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/process-document/${encodeURIComponent(id)}`, {
        method: "POST",
        credentials: "same-origin",
      });
      const j = (await r.json()) as { error?: string; extractionsCreated?: number; status?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Processing failed.");
        return;
      }
      setMsg(
        `Processed: ${j.extractionsCreated ?? 0} extraction row(s); status=${j.status ?? "?"}`.trim()
      );
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const buildMatrix = async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/build-matrix`, { method: "POST", credentials: "same-origin" });
      const j = (await r.json()) as { rowsUpserted?: number; error?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Matrix build failed.");
        return;
      }
      setMsg(`Matrix rebuilt: ${j.rowsUpserted ?? 0} row(s).`);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const genIssues = async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/generate-issues`, { method: "POST", credentials: "same-origin" });
      const j = (await r.json()) as { created?: number; error?: string };
      if (!r.ok) setMsg(j.error ?? "Issues generation failed.");
      else setMsg(`Regenerated diligence issues (${j.created ?? 0} created).`);
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const exportBundle = async () => {
    if (!tk) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/export`, { method: "POST", credentials: "same-origin" });
      const j = (await r.json()) as Record<string, unknown>;
      if (!r.ok) {
        setMsg(String(j.error ?? "Export failed."));
        return;
      }
      const memo = typeof j.issuesMemoMarkdown === "string" ? j.issuesMemoMarkdown : "";
      await navigator.clipboard.writeText(memo);
      setMsg("Issues memo markdown copied to clipboard. Full JSON payloads are in the browser network response if you need CSV fields.");
    } catch {
      setMsg("Could not copy export memo.");
    } finally {
      setBusy(false);
    }
  };

  const sendToUniverse = async () => {
    if (!tk || matrixSelectedIds.size === 0) {
      setMsg("Select at least one matrix row.");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(`${wfApi(tk)}/send-to-entity-universe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ matrixRowIds: [...matrixSelectedIds], onlyConfirmed: false, force: false }),
      });
      const j = (await r.json()) as { created?: number; updated?: number; skipped?: number; error?: string };
      if (!r.ok) {
        setMsg(j.error ?? "Send failed.");
        return;
      }
      setMsg(`Entity Universe: created ${j.created ?? 0}, updated ${j.updated ?? 0}, skipped ${j.skipped ?? 0}.`);
    } finally {
      setBusy(false);
    }
  };

  const setMatrixConfirmed = async (id: string) => {
    if (!tk) return;
    setBusy(true);
    try {
      const r = await fetch(`${wfApi(tk)}/matrix/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reviewStatus: "confirmed" }),
      });
      const j = (await r.json()) as { error?: string };
      if (!r.ok) setMsg(j.error ?? "Update failed.");
      await loadAll();
    } finally {
      setBusy(false);
    }
  };

  const tableShell =
    "w-full border-collapse text-left text-[12px] text-[var(--text)]";

  return (
    <div className="flex flex-col gap-3">
      <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--card)]/30 p-3 text-[11px] leading-relaxed text-[var(--muted)]">
        <p>{INTRO_COPY}</p>
        <p className="rounded border border-[var(--border)] px-2 py-1.5 text-[var(--text)]">{WARN_COPY}</p>
        <p>{EX21_NOTE}</p>
      </div>

      {msg ? (
        <div className="rounded border border-[var(--accent)]/25 bg-[rgba(0,212,170,0.06)] px-2 py-1 text-[11px] text-[var(--text)]">
          {msg}
        </div>
      ) : null}

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <h4 className="text-[12px] font-semibold text-[var(--text)]">1. Credit document finder</h4>
        <p className="text-[11px] text-[var(--muted)]">
          Systematic SEC EDGAR debt-document search (material credit agreements, indentures, guarantees, collateral,
          intercreditor, amendments, RSAs, etc.) using submissions + filing-directory indexes + primary-document exhibit
          parsing where fetched — merged with saved/workspace captures. Responses cache briefly server-side; use{" "}
          <code className="text-[var(--text)]">SEC_EDGAR_USER_AGENT</code>. POST JSON body may include{" "}
          <code className="text-[var(--text)]">lookbackYears</code>,{" "}
          <code className="text-[var(--text)]">companyName</code>, <code className="text-[var(--text)]">cik</code>,{" "}
          <code className="text-[var(--text)]">includeDef14a</code>.
        </p>
        <button
          type="button"
          className="rounded border border-[var(--accent)]/50 px-2 py-1 text-[11px] text-[var(--text)] hover:bg-[rgba(0,212,170,0.12)]"
          disabled={busy}
          onClick={() => void scanSaved()}
        >
          Find credit documents
        </button>
        {(() => {
          const es = edgarDebtReport?.executiveSummary as
            | {
                debtRelatedDocumentsFound?: number;
                creditAgreementsFound?: number;
                indenturesNoteDocumentsFound?: number;
                amendmentsFound?: number;
                materialMissingDocuments?: string[];
              }
            | undefined;
          if (!es) return null;
          return (
            <div className="space-y-2 rounded border border-[var(--border)] bg-[var(--card)]/40 p-3 text-[11px] text-[var(--muted)]">
              <div className="font-semibold text-[var(--text)]">EDGAR debt scan (deliverables A–E)</div>
              <ul className="list-disc space-y-0.5 pl-4 text-[var(--text)]">
                <li>Debt-related SEC exhibits (working links): {es.debtRelatedDocumentsFound ?? "—"}</li>
                <li>Credit agreements (classified): {es.creditAgreementsFound ?? "—"}</li>
                <li>Indentures / notes (classified): {es.indenturesNoteDocumentsFound ?? "—"}</li>
                <li>Amendments / waivers / consents (classified): {es.amendmentsFound ?? "—"}</li>
              </ul>
              {(es.materialMissingDocuments?.length ?? 0) > 0 ? (
                <div>
                  <div className="mb-0.5 text-[10px] uppercase tracking-wide text-[var(--muted2)]">
                    Missing / expected (10-K disclosure heuristic)
                  </div>
                  <ul className="list-disc pl-4 text-[var(--text)]">
                    {es.materialMissingDocuments!.slice(0, 6).map((m, i) => (
                      <li key={i} className="break-words">
                        {m}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-[10px] leading-snug text-[var(--muted2)]">
                Full source-backed table (22 columns), facility grouping map (B), missing checklist (D), and recommended
                next searches (E) are returned as JSON field{" "}
                <code className="text-[var(--text)]">edgarDebtSearch</code> on this POST — open Network → find-documents
                → Response.
              </p>
            </div>
          );
        })()}
        {candidates.length > 0 ? (
          <div className="overflow-x-auto">
            <table className={tableShell}>
              <thead>
                <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                  <th className="py-1 pr-2">Title</th>
                  <th className="py-1 pr-2">Type</th>
                  <th className="py-1 pr-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const q = Boolean(c.savedDocumentRefId && refsQueued.has(c.savedDocumentRefId));
                  return (
                    <tr key={`${c.savedDocumentRefId}-${c.documentTitle}`} className="border-b border-[var(--border)]/60">
                      <td className="max-w-[240px] py-1 pr-2">
                        <DocTitleLink title={c.documentTitle} href={c.openUrl} />
                      </td>
                      <td className="py-1 pr-2 whitespace-nowrap">{String(c.documentType).replace(/_/g, " ")}</td>
                      <td className="py-1 pr-2">
                        <button
                          type="button"
                          disabled={busy || !c.savedDocumentRefId || q}
                          className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px] disabled:opacity-40"
                          onClick={() => void queueCandidate(c)}
                        >
                          {q ? "Queued" : "Add to queue"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <h4 className="text-[12px] font-semibold text-[var(--text)]">2. Processing queue</h4>
        <div className="overflow-x-auto">
          <table className={tableShell}>
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                <th className="py-1 pr-2">Title</th>
                <th className="py-1 pr-2">Status</th>
                <th className="py-1 pr-2">Process</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={String(d.id)} className="border-b border-[var(--border)]/60">
                  <td className="max-w-[220px] py-1 pr-2">
                    <DocTitleLink
                      title={String(d.documentTitle)}
                      href={typeof d.documentOpenUrl === "string" ? d.documentOpenUrl : null}
                    />
                  </td>
                  <td className="py-1 pr-2 whitespace-nowrap">{String(d.processingStatus)}</td>
                  <td className="py-1 pr-2">
                    <button
                      type="button"
                      disabled={busy}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px]"
                      onClick={() => void processDoc(String(d.id))}
                    >
                      Extract entities
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <h4 className="text-[12px] font-semibold text-[var(--text)]">3. Extracted entity review</h4>
        <div className="overflow-x-auto">
          <table className={tableShell}>
            <thead>
              <tr className="border-b border-[var(--border)] text-[10px] uppercase text-[var(--muted2)]">
                <th className="py-1 pr-2">Entity</th>
                <th className="py-1 pr-2">Role</th>
                <th className="py-1 pr-2">Source</th>
                <th className="py-1 pr-2">Excerpt</th>
                <th className="py-1 pr-2">Ex.21?</th>
              </tr>
            </thead>
            <tbody>
              {extractions.map((e) => (
                <tr key={String(e.id)} className="border-b border-[var(--border)]/60">
                  <td className="py-1 pr-2">{String(e.entityName)}</td>
                  <td className="py-1 pr-2 whitespace-nowrap">{String(e.entityRole).replace(/_/g, " ")}</td>
                  <td className="max-w-[140px] truncate py-1 pr-2">{String(e.sourceDocumentTitle ?? "—")}</td>
                  <td className="max-w-[200px] truncate py-1 pr-2">{String(e.excerpt ?? "").replace(/\s+/g, " ")}</td>
                  <td className="py-1 pr-2">{e.listedInExhibit21 ? "yes" : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-[12px] font-semibold text-[var(--text)]">4. Entity role matrix</h4>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--accent)]/45 px-2 py-0.5 text-[10px] text-[var(--text)]"
            onClick={() => void buildMatrix()}
          >
            Build / refresh matrix
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px]"
            onClick={() => void exportBundle()}
          >
            Export memo (copy)
          </button>
          <button
            type="button"
            disabled={busy || matrixSelectedIds.size === 0}
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[10px]"
            onClick={() => void sendToUniverse()}
          >
            Send selected rows to Entity Universe
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)]">{MATRIX_NOTE}</p>
        <div className="max-h-[420px] overflow-auto">
          <div className="inline-block min-w-full align-middle">
            <table className={tableShell}>
              <thead>
                <tr className="sticky top-0 z-10 border-b border-[var(--border)] bg-[var(--card)] text-[9px] uppercase text-[var(--muted2)]">
                  <th className="sticky left-0 z-20 bg-[var(--card)] py-1 pr-1 shadow-[2px_0_0_var(--border)]">
                    Sel.
                  </th>
                  <th className="sticky left-8 z-20 min-w-[160px] bg-[var(--card)] py-1 pr-2 shadow-[2px_0_0_var(--border)]">
                    Entity
                  </th>
                  <th className="py-1 pr-2">Ex.21?</th>
                  <th className="py-1 pr-2">Score</th>
                  {CREDIT_MATRIX_ROLE_KEYS.map((k) => (
                    <th key={k} className="min-w-[36px] py-1 pr-1 text-center">
                      <span title={MATRIX_COLUMN_LABELS[k]}>{MATRIX_COLUMN_LABELS[k]?.slice(0, 6) ?? k}</span>
                    </th>
                  ))}
                  <th className="py-1 pr-2">Confirm</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((r) => {
                  const rf = r.roleFlagsJson as Record<string, RoleFlagTriState | string>;
                  const id = String(r.id);
                  const checked = matrixSelectedIds.has(id);
                  return (
                    <tr key={id} className="border-b border-[var(--border)]/60">
                      <td className="sticky left-0 bg-[var(--card)] py-1 pr-1">
                        <input
                          aria-label={`Select ${r.entityName}`}
                          type="checkbox"
                          checked={checked}
                          onChange={(ev) => {
                            const next = new Set(matrixSelectedIds);
                            if (ev.target.checked) next.add(id);
                            else next.delete(id);
                            setMatrixSelectedIds(next);
                          }}
                        />
                      </td>
                      <td className="sticky left-8 min-w-[160px] bg-[var(--card)] py-1 pr-2 shadow-[2px_0_0_var(--border)]">
                        <button type="button" className="text-left underline-offset-2 hover:underline" onClick={() => setEvidenceOpen(r)}>
                          {String(r.entityName)}
                        </button>
                      </td>
                      <td className="py-1 pr-2">{r.listedInExhibit21 ? "Y" : "—"}</td>
                      <td className="py-1 pr-2">{String(r.relevanceScore)}</td>
                      {CREDIT_MATRIX_ROLE_KEYS.map((k) => (
                        <td key={k} className="py-1 text-center tabular-nums">
                          <span title={MATRIX_COLUMN_LABELS[k]}>{roleCell(String(rf[k]))}</span>
                        </td>
                      ))}
                      <td className="py-1 pr-2">
                        <button type="button" className="text-[10px] underline" disabled={busy} onClick={() => void setMatrixConfirmed(id)}>
                          Mark confirmed
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <h4 className="text-[12px] font-semibold text-[var(--text)]">5. Entity relationships</h4>
        <p className="text-[11px] text-[var(--muted)]">
          Parent/child and guarantee-style edges can be persisted with{" "}
          <code className="text-[var(--text)]">GET/POST /credit-doc-entities/relationships</code>. UI forms for joinder chains can attach here next.
        </p>
      </section>

      <section className="space-y-2 rounded border border-[var(--border)] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <h4 className="text-[12px] font-semibold text-[var(--text)]">6. Credit document issues</h4>
          <button
            type="button"
            disabled={busy}
            className="rounded border border-[var(--accent)]/45 px-2 py-0.5 text-[10px] text-[var(--text)]"
            onClick={() => void genIssues()}
          >
            Regenerate from matrix
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          <strong>7–8.</strong> Push confirmed rows via the matrix toolbar (&quot;Send selected rows&quot;). For downloadable CSV payloads, POST{" "}
          <code className="text-[var(--text)]">/credit-doc-entities/export</code>; clipboard export captures the memo markdown only.
        </p>
        <ul className="max-h-[200px] list-none space-y-1 overflow-auto text-[11px]">
          {issues.length === 0 ? <li className="text-[var(--muted)]">No issues logged yet.</li> : null}
          {issues.map((issue) => (
            <li key={String(issue.id)} className="rounded border border-[var(--border)]/70 px-2 py-1">
              <span className="font-medium text-[var(--text)]">({String(issue.severity)}) {String(issue.issueTitle)}</span>
              <p className="text-[var(--muted)]">{String(issue.issueDescription).slice(0, 420)}</p>
            </li>
          ))}
        </ul>
      </section>

      {evidenceOpen ? (
        <div role="dialog" aria-modal className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-3 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && setEvidenceOpen(null)}>
          <div className="max-h-[70vh] w-full max-w-lg overflow-auto rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-[12px] shadow-lg">
            <div className="mb-2 flex items-center justify-between gap-2">
              <strong className="text-[var(--text)]">{String(evidenceOpen.entityName)}</strong>
              <button type="button" className="text-[11px]" onClick={() => setEvidenceOpen(null)}>
                Close
              </button>
            </div>
            <p className="text-[var(--muted)]">
              Exhibit 21: {evidenceOpen.listedInExhibit21 ? "listed" : "not listed"} · Relevance score:{" "}
              {String(evidenceOpen.relevanceScore)}
            </p>
            <pre className="mt-2 max-h-[40vh] overflow-auto whitespace-pre-wrap rounded border border-[var(--border)] p-2 text-[10px] text-[var(--text)]">
              {String(evidenceOpen.keyEvidence || "(no single excerpt — inspect sourceEvidenceJson via API/export)")}
            </pre>
            <p className="mt-2 text-[10px] text-[var(--muted)]">
              Full structured evidence per matrix cell lives in <code className="text-[var(--text)]">sourceEvidenceJson</code> on the matrix
              row (API/export).
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
