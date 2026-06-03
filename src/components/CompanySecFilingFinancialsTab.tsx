"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import {
  downloadFilingStatementsXlsx,
  saveFilingStatementsXlsxToServer,
  type SecFilingFinancialsApiResponse,
} from "@/lib/sec-filing-financials-save-client";
import type { FilingHtmlStatement } from "@/lib/sec-filing-financials";
import { SelfDiagnosticChecklistTable } from "@/components/SelfDiagnosticChecklistTable";
import type { SelfDiagnosticCheckResult } from "@/lib/sec-self-diagnostic-checklist";
import type { XbrlExportValidationIssue } from "@/lib/sec-xbrl-export-validation";

type ApiResponse = SecFilingFinancialsApiResponse;
type DiagnosticsResponse =
  | {
      ok: true;
      ticker: string;
      checked: number;
      suspicious: number;
      failures: Array<{
        accessionNumber: string;
        filingDate: string;
        form: string;
        issues: string[];
        summaries: Array<{ id: string; periods: string[]; firstRows: string[] }>;
        validationFailures?: XbrlExportValidationIssue[];
        selfDiagnosticChecklist?: SelfDiagnosticCheckResult[];
        statementStructureDiagnostics?: XbrlExportValidationIssue[];
      }>;
    }
  | { ok: false; error?: string; ticker?: string };

function fmtValidationUsd(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function ValidationReconciliationBlock({ issue }: { issue: XbrlExportValidationIssue }) {
  const rec = issue.reconciliation;
  if (!rec) return null;
  return (
    <div className="mt-2 rounded border text-[10px] leading-snug" style={{ borderColor: "var(--border2)" }}>
      <p className="border-b px-2 py-1.5 italic" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        {rec.formula}
      </p>
      <div className="max-h-64 overflow-auto">
        <table className="w-full border-collapse font-mono text-[10px]">
          <thead>
            <tr className="border-b text-left" style={{ borderColor: "var(--border2)", color: "var(--muted)" }}>
              <th className="px-2 py-1 font-normal">Line</th>
              <th className="px-2 py-1 text-right font-normal">w</th>
              <th className="px-2 py-1 text-right font-normal">Amount</th>
              <th className="px-2 py-1 text-right font-normal">Gap / w×V</th>
            </tr>
          </thead>
          <tbody>
            {rec.lines.map((ln, i) => (
              <tr key={i} className="border-t" style={{ borderColor: "var(--border2)", color: "var(--text)" }}>
                <td className="px-2 py-1">{ln.label}</td>
                <td className="px-2 py-1 text-right">{ln.weight != null ? String(ln.weight) : "—"}</td>
                <td className="px-2 py-1 text-right">{fmtValidationUsd(ln.valueUsd)}</td>
                <td className="px-2 py-1 text-right">
                  {ln.contributionUsd != null ? fmtValidationUsd(ln.contributionUsd) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function fmtUsdMillions(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return v < 0 ? `($${s})` : `$${s}`;
}

function FilingStatementTable({ stmt }: { stmt: FilingHtmlStatement }) {
  const periods = stmt.periods;
  return (
    <Card title={stmt.title}>
      <div className="overflow-auto">
        <table className="min-w-[1040px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5 text-left text-sm font-medium" style={{ color: "var(--muted2)" }}>
                Line
              </th>
              {periods.map((p) => (
                <th key={p.key} className="px-3 py-2.5 text-right align-bottom text-sm" style={{ color: "var(--muted2)" }} title={p.label}>
                  <span className="inline-block max-w-[220px] whitespace-normal leading-snug">{p.shortLabel || p.label}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stmt.rows.map((row, idx) => (
              <tr key={`${row.concept}-${idx}`} className="border-t" style={{ borderColor: "var(--border2)" }}>
                <td
                  className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5"
                  style={{ color: "var(--text)", fontWeight: row.rowKind !== "data" ? 600 : 400 }}
                  title={row.concept}
                >
                  {row.label}
                </td>
                {periods.map((p) => {
                  const display =
                    row.valueFormat === "usd_millions"
                      ? fmtUsdMillions(row.values[p.key] ?? null)
                      : row.displayValues[p.key] || "—";
                  return (
                    <td
                      key={p.key}
                      className="px-3 py-2.5 text-right text-base font-mono tabular-nums tracking-tight"
                      style={{ color: "var(--text)", opacity: display === "—" ? 0.75 : 1 }}
                    >
                      {display}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Dollar amounts are normalized to <span className="font-medium">$ millions</span>; per-share and share-count rows keep
        the filing&apos;s native display
        {stmt.units ? (
          <>
            {" "}
            (source scale: <span className="font-medium">{stmt.units}</span>)
          </>
        ) : null}
        . Source: <span className="font-mono">{stmt.sourceHtmlFile ?? stmt.role}</span>
      </p>
    </Card>
  );
}

export function CompanySecFilingFinancialsTab({ ticker }: { ticker: string }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedAcc, setSelectedAcc] = useState("");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagErr, setDiagErr] = useState<string | null>(null);
  const [diag, setDiag] = useState<Extract<DiagnosticsResponse, { ok: true }> | null>(null);

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    setSaveMsg(null);
    setDiag(null);
    setDiagErr(null);

    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(`/api/sec/filing-financials/${encodeURIComponent(tk)}${qs}`, { cache: "no-store" });
        const j = (await res.json()) as ApiResponse;
        if (!res.ok || j.ok === false) throw new Error(j.error || "Failed to load SEC filing financials");
        if (!cancelled) setData(j);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tk, selectedAcc]);

  useEffect(() => {
    if (!data?.selected?.accessionNumber) return;
    setSelectedAcc(data.selected.accessionNumber);
  }, [data?.selected?.accessionNumber]);

  if (!tk) {
    return (
      <Card title="SEC Filing Financials">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  const filings = data?.filings ?? [];
  const statements = data?.statements ?? [];
  const selected = data?.selected?.accessionNumber ?? "";

  return (
    <div className="space-y-4">
      <Card title={`SEC Filing Financials — ${tk}`}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted)" }}>
            Filing
          </span>
          <select
            className="rounded border px-2 py-1 text-xs"
            style={{ borderColor: "var(--border2)", background: "var(--card2)", color: "var(--text)" }}
            value={selectedAcc}
            onChange={(e) => setSelectedAcc(e.target.value)}
          >
            {filings.map((f) => (
              <option key={f.accessionNumber} value={f.accessionNumber}>
                {f.filingDate} · {f.form} · {f.accessionNumber}
              </option>
            ))}
          </select>
          {selected ? (
            <span className="text-[10px] font-mono" style={{ color: "var(--muted)" }}>
              {selected}
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            disabled={loading || statements.length === 0}
            onClick={() => {
              if (!data?.selected || statements.length === 0) return;
              downloadFilingStatementsXlsx(
                tk,
                data.companyName,
                data.cik,
                data.selected,
                statements
              );
              setSaveMsg("Downloaded Excel workbook for the selected filing.");
            }}
          >
            Download Excel
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
            disabled={loading || saveBusy || statements.length === 0 || authStatus !== "authenticated"}
            title={authStatus !== "authenticated" ? "Sign in to save the workbook to Saved Documents." : "Save workbook to Saved Documents."}
            onClick={() => {
              if (!data?.selected || statements.length === 0 || authStatus !== "authenticated") return;
              setSaveBusy(true);
              setSaveMsg(null);
              void (async () => {
                const result = await saveFilingStatementsXlsxToServer(
                  tk,
                  data.selected!,
                  data.companyName,
                  data.cik,
                  statements
                );
                setSaveBusy(false);
                setSaveMsg(result.ok ? `Saved ${result.filename ?? "workbook"} to Saved Documents.` : result.error);
              })();
            }}
          >
            {saveBusy ? "Saving…" : "Save to Saved Documents"}
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            style={{ borderColor: "var(--border2)", color: "var(--text)", background: "var(--card2)" }}
            disabled={loading || diagBusy}
            onClick={() => {
              setDiagBusy(true);
              setDiagErr(null);
              void (async () => {
                try {
                  const res = await fetch(`/api/sec/filing-financials/${encodeURIComponent(tk)}/diagnostics?max=30`, {
                    cache: "no-store",
                  });
                  const j = (await res.json()) as DiagnosticsResponse;
                  if (!res.ok || j.ok === false) {
                    throw new Error(("error" in j ? j.error : undefined) || "Failed to run diagnostics");
                  }
                  setDiag(j);
                } catch (e) {
                  setDiagErr(e instanceof Error ? e.message : "Failed to run diagnostics");
                } finally {
                  setDiagBusy(false);
                }
              })();
            }}
          >
            {diagBusy ? "Running Self-Diagnostic…" : "Run Self-Diagnostic"}
          </button>
        </div>

        <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
          Pulls the three primary statements from the filing&apos;s main SEC HTML document, not from XBRL fact tables.
        </p>

        {saveMsg ? (
          <p className="mt-2 text-[10px] leading-snug" style={{ color: saveMsg.startsWith("Saved") || saveMsg.startsWith("Downloaded") ? "var(--muted2)" : "var(--warn)" }}>
            {saveMsg}
          </p>
        ) : null}

        {loading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading…
          </p>
        ) : err ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {err}
          </p>
        ) : null}

        {diagErr ? (
          <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--warn)" }}>
            {diagErr}
          </p>
        ) : null}
      </Card>

      {diag ? (
        <Card title={`Self-Diagnostic — ${diag.ticker}`}>
          <p className="text-xs leading-snug" style={{ color: "var(--muted2)" }}>
            Checked {diag.checked} filings. Flagged {diag.suspicious}.
          </p>
          {diag.failures.length === 0 ? (
            <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
              No suspicious filings found in this sweep.
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {diag.failures.map((failure) => (
                <div key={failure.accessionNumber} className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
                  <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
                    {failure.filingDate} · {failure.form} · {failure.accessionNumber}
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-xs" style={{ color: "var(--warn)" }}>
                    {failure.issues.map((msg, i) => (
                      <li key={i}>{msg}</li>
                    ))}
                  </ul>
                  {failure.selfDiagnosticChecklist && failure.selfDiagnosticChecklist.length > 0 ? (
                    <SelfDiagnosticChecklistTable checklist={failure.selfDiagnosticChecklist} compact />
                  ) : null}
                  {failure.validationFailures && failure.validationFailures.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                        Tie-out / rollup detail
                      </p>
                      {failure.validationFailures.map((v, vi) => (
                        <details
                          key={`${v.check}-${v.periodKey}-vf-${vi}`}
                          className="rounded border text-[11px]"
                          style={{ borderColor: "var(--border2)" }}
                          open={vi === 0}
                        >
                          <summary className="cursor-pointer px-2 py-1.5 font-medium" style={{ color: "var(--text)" }}>
                            {v.periodLabel} · {v.statement} · {v.check}
                          </summary>
                          <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
                            {v.detail}
                            <ValidationReconciliationBlock issue={v} />
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {failure.statementStructureDiagnostics && failure.statementStructureDiagnostics.length > 0 ? (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                        Balance sheet / cash flow math
                      </p>
                      {failure.statementStructureDiagnostics.map((v, vi) => (
                        <details
                          key={`${v.check}-${v.periodKey}-sd-${vi}`}
                          className="rounded border text-[11px]"
                          style={{ borderColor: "var(--border2)" }}
                        >
                          <summary className="cursor-pointer px-2 py-1.5 font-medium" style={{ color: "var(--text)" }}>
                            {v.periodLabel} · {v.check}
                          </summary>
                          <div className="border-t px-2 py-1.5" style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
                            {v.detail}
                            <ValidationReconciliationBlock issue={v} />
                          </div>
                        </details>
                      ))}
                    </div>
                  ) : null}
                  {failure.summaries.map((summary) => (
                    <div key={summary.id} className="mt-2 text-[11px] leading-snug" style={{ color: "var(--muted2)" }}>
                      <span className="font-semibold" style={{ color: "var(--text)" }}>
                        {summary.id}
                      </span>
                      : periods `{summary.periods.join(" | ")}`; first rows `{summary.firstRows.join(" | ")}`
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </Card>
      ) : null}

      {!loading && !err && statements.length > 0 ? (
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            Primary statements (income statement, balance sheet, cash flow)
          </p>
          {statements.map((stmt) => (
            <FilingStatementTable key={stmt.id} stmt={stmt} />
          ))}
        </div>
      ) : null}

      {!loading && !err && statements.length === 0 ? (
        <Card title="No filing statement tables found">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            SEC didn&apos;t return usable HTML statement reports for this filing. Try a different filing.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
