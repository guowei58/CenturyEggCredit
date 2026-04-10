"use client";

import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import {
  normalizeAccessionKey,
  savePresentedStatementsXlsxToServer,
  visiblePeriodsAndRowsForStatement,
  type PresentedStatementForSave,
  type SecXbrlAsPresentedApiResponse,
} from "@/lib/sec-xbrl-as-presented-save-client";

type PresentedStatement = PresentedStatementForSave;
type ApiResponse = SecXbrlAsPresentedApiResponse;

type IxbrlFilingSection = "mdna" | "segment";

type IxbrlMdnaTable = {
  id: string;
  caption: string | null;
  rows: string[][];
  tableHtml?: string | null;
  factCount: number;
  section: IxbrlFilingSection;
};

type IxbrlMdnaJson =
  | {
      ok: true;
      tables: IxbrlMdnaTable[];
      mdnaHeadingFound: boolean;
      segmentHeadingFound: boolean;
      mdnaTableHit: boolean;
      selected?: { primaryDocument?: string; form?: string; accessionNumber?: string };
      error?: undefined;
    }
  | { ok: false; error?: string; tables?: IxbrlMdnaTable[] };

/** Raw values from XBRL are assumed USD; show everything in $ millions for a uniform scale. */
function fmt(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}

function StatementAsPresentedTable({ stmt }: { stmt: PresentedStatement }) {
  const { periods, rows } = visiblePeriodsAndRowsForStatement(stmt);
  return (
    <Card title={stmt.title}>
      <div className="overflow-auto">
        <table className="min-w-[920px] w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5 text-left text-sm font-medium" style={{ color: "var(--muted2)" }}>
                Line
              </th>
              {periods.map((p) => {
                const head = (p.shortLabel?.trim() ? p.shortLabel : p.label) || p.label;
                return (
                  <th key={p.key} className="px-3 py-2.5 text-right align-bottom text-sm" style={{ color: "var(--muted2)" }} title={p.label}>
                    <span className="inline-block max-w-[160px] whitespace-normal leading-snug">{head}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={`${r.concept}-${idx}`} className="border-t" style={{ borderColor: "var(--border2)" }}>
                <td
                  className="sticky left-0 z-10 bg-[var(--panel)] px-3 py-2.5"
                  style={{ color: "var(--text)", paddingLeft: `${10 + Math.min(10, r.depth) * 14}px` }}
                  title={r.concept}
                >
                  {r.label}
                </td>
                {periods.map((p) => (
                  <td key={p.key} className="px-3 py-2.5 text-right text-base font-mono tabular-nums tracking-tight" style={{ color: "var(--text)" }}>
                    {fmt(r.values[p.key] ?? null)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Amounts in <span className="font-medium">$ millions</span> (USD). Grid shows{" "}
        <span className="font-medium">SEC-style display</span> (instance fact, including inline sign, inverted only when
        the presentation arc uses a negated label role). API JSON includes <span className="font-medium">rawValues</span>{" "}
        before that flip. Paired &quot;(XBRL raw)&quot; sheets hold instance-side numbers. Period columns are omitted when
        fewer than ~5% of lines have a fact in that column (single one-off tags). Role:{" "}
        <span className="font-mono">{stmt.role}</span>
      </p>
    </Card>
  );
}

const IXBRL_SECTION_LABEL: Record<IxbrlFilingSection, string> = {
  mdna: "MD&A",
  segment: "Segment note",
};

function IxbrlHtmlTableCard({ table }: { table: IxbrlMdnaTable }) {
  const colCount = table.rows.reduce((m, r) => Math.max(m, r.length), 0) || 1;
  const sectionLabel = IXBRL_SECTION_LABEL[table.section];
  const title =
    (table.caption?.trim() ? table.caption : null) ??
    (table.factCount > 0
      ? `Filing table (${table.factCount} tagged amounts)`
      : "Filing table");

  const safeHtml =
    table.tableHtml && table.tableHtml.length > 0
      ? DOMPurify.sanitize(table.tableHtml, { USE_PROFILES: { html: true } })
      : null;

  return (
    <Card
      title={
        <span className="flex flex-wrap items-center gap-2">
          <span>{title}</span>
          <span className="rounded px-2 py-0.5 text-[10px] font-semibold uppercase sm:text-xs" style={{ background: "var(--panel)", color: "var(--accent)" }}>
            {sectionLabel}
          </span>
        </span>
      }
    >
      <div className="overflow-auto">
        {safeHtml ? (
          <div
            className="ixbrl-filing-table-root min-w-[640px] text-sm leading-snug [&_table]:w-full [&_table]:min-w-0 [&_table]:border-collapse [&_table]:text-[var(--text)] [&_caption]:caption-top [&_caption]:mb-3 [&_caption]:w-full [&_caption]:text-left [&_caption]:text-base [&_caption]:font-semibold [&_caption]:leading-snug [&_caption]:text-[var(--text)] [&_thead>tr]:bg-transparent [&_tbody>tr]:bg-transparent [&_th]:border [&_th]:border-solid [&_th]:border-[var(--border2)] [&_th]:bg-[var(--panel)] [&_th]:px-2.5 [&_th]:py-2 [&_th]:align-bottom [&_th]:text-left [&_th]:font-medium [&_th]:text-[var(--text)] [&_td]:border [&_td]:border-solid [&_td]:border-[var(--border2)] [&_td]:px-2.5 [&_td]:py-2 [&_td]:align-top [&_td]:text-[var(--text)] [&_tbody>tr:nth-child(odd)>td]:bg-white/[0.04] [&_tbody>tr:nth-child(even)>td]:bg-white/[0.07] [&_.ixbrl-nf]:inline-block [&_.ixbrl-nf]:text-right [&_.ixbrl-nf]:font-mono [&_.ixbrl-nf]:tabular-nums"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: safeHtml }}
          />
        ) : (
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri} className="border-t" style={{ borderColor: "var(--border2)" }}>
                  {Array.from({ length: colCount }, (_, ci) => (
                    <td
                      key={ci}
                      className={`px-3 py-2.5 align-top leading-snug ${ci > 0 ? "text-base font-mono tabular-nums tracking-tight" : ""}`}
                      style={{
                        color: "var(--text)",
                        textAlign: ci > 0 ? "right" : "left",
                      }}
                    >
                      {row[ci] ?? ""}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Tables use the filing&apos;s HTML when possible (preserves merged cells). When that isn&apos;t available, a flat grid is shown.
        <span className="font-mono"> ix:nonFraction</span> amounts are shown as{" "}
        <span className="font-medium">$ millions</span> (USD) using element text × <span className="font-mono">10^scale</span> and optional{" "}
        <span className="font-mono">sign</span>.
      </p>
    </Card>
  );
}

export function CompanySecXbrlFinancialsTab({ ticker }: { ticker: string }) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selectedAcc, setSelectedAcc] = useState<string>("");
  const [excelSaving, setExcelSaving] = useState(false);
  const [excelSaveMsg, setExcelSaveMsg] = useState<string | null>(null);
  const [ixbrl, setIxbrl] = useState<IxbrlMdnaJson | null>(null);
  const [ixLoading, setIxLoading] = useState(false);
  const [ixErr, setIxErr] = useState<string | null>(null);

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(`/api/sec/xbrl/as-presented/${encodeURIComponent(tk)}${qs}`, { cache: "no-store" });
        const j = (await res.json()) as ApiResponse;
        if (!res.ok) throw new Error(j.error || "Failed to load SEC XBRL financials");
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
    if (!tk) return;
    let cancelled = false;
    setIxLoading(true);
    setIxErr(null);
    setIxbrl(null);
    void (async () => {
      try {
        const qs = selectedAcc ? `?acc=${encodeURIComponent(selectedAcc)}` : "";
        const res = await fetch(
          `/api/sec/xbrl/ixbrl-mdna-tables/${encodeURIComponent(tk)}${qs}`,
          { cache: "no-store" }
        );
        const j = (await res.json()) as IxbrlMdnaJson;
        if (cancelled) return;
        if (!res.ok || j.ok === false) {
          setIxErr(j.error ?? `Inline XBRL fetch failed (${res.status})`);
          setIxbrl(null);
          return;
        }
        setIxbrl(j);
      } catch (e) {
        if (!cancelled) setIxErr(e instanceof Error ? e.message : "Inline XBRL fetch failed");
      } finally {
        if (!cancelled) setIxLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk, selectedAcc]);

  const filings = data?.filings ?? [];
  const selected = data?.selected?.accessionNumber ?? "";
  const statements = data?.statements ?? [];

  useEffect(() => {
    if (!data?.selected?.accessionNumber) return;
    setSelectedAcc(data.selected.accessionNumber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.selected?.accessionNumber]);

  if (!tk) {
    return (
      <Card title="SEC XBRL Financials">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company with a ticker.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card title={`SEC XBRL Financials — ${tk}`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs" style={{ color: "var(--muted2)" }}>
              {data?.companyName ? <span style={{ color: "var(--text)" }}>{data.companyName}</span> : null}
              {data?.cik ? <> · CIK {data.cik}</> : null}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
        <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted)" }}>
          Bulk-save all filings and AI consolidation live under{" "}
          <span className="font-medium" style={{ color: "var(--muted2)" }}>
            The Good, Bad and Ugly Historical Financial Statements → The Bad
          </span>
          .
        </p>
        {loading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading…
          </p>
        ) : err ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {err}
          </p>
        ) : null}
      </Card>

      {!loading && !err && statements.length > 0 ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm" style={{ color: "var(--muted2)" }}>
              Primary statements (income statement, balance sheet, cash flow)
            </p>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <button
                type="button"
                className="btn-shell hi rounded-md px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                disabled={excelSaving || authStatus !== "authenticated"}
                title={
                  authStatus !== "authenticated"
                    ? "Sign in to save this workbook to Saved Documents for this ticker."
                    : "Stores .xlsx in Saved Documents; saving again for the same filing replaces that workbook."
                }
                onClick={() => {
                  if (!data?.selected?.accessionNumber || authStatus !== "authenticated") return;
                  const sel = data.selected;
                  const accKey = normalizeAccessionKey(sel.accessionNumber);
                  const filingMeta = filings.find((f) => normalizeAccessionKey(f.accessionNumber) === accKey);
                  const form = (sel.form ?? filingMeta?.form ?? "").trim();
                  const filingDate = (sel.filingDate ?? filingMeta?.filingDate ?? "").trim();
                  const accessionNumber = (sel.accessionNumber ?? filingMeta?.accessionNumber ?? "").trim();
                  if (!form || !filingDate || !accessionNumber) {
                    setExcelSaveMsg("Missing filing metadata; pick a filing and try again.");
                    return;
                  }
                  setExcelSaveMsg(null);
                  setExcelSaving(true);
                  void (async () => {
                    try {
                      const r = await savePresentedStatementsXlsxToServer(
                        tk,
                        { form, filingDate, accessionNumber },
                        data.companyName,
                        data.cik,
                        statements,
                        data.validation,
                        data.calculationLinkbaseLoaded
                      );
                      if (r.ok) {
                        setExcelSaveMsg(
                          r.filename ? `Saved to Saved Documents: ${r.filename}` : "Saved to Saved Documents."
                        );
                      } else {
                        setExcelSaveMsg(r.error);
                      }
                    } catch (e) {
                      setExcelSaveMsg(e instanceof Error ? e.message : "Save failed.");
                    } finally {
                      setExcelSaving(false);
                    }
                  })();
                }}
              >
                {excelSaving ? "Saving…" : "Save as Excel"}
              </button>
              {authStatus !== "authenticated" ? (
                <span className="max-w-[220px] text-right text-[10px]" style={{ color: "var(--muted)" }}>
                  Sign in to save into Saved Documents.
                </span>
              ) : excelSaveMsg ? (
                <span className="max-w-[280px] text-right text-[10px]" style={{ color: "var(--muted2)" }}>
                  {excelSaveMsg}
                </span>
              ) : (
                <span className="max-w-[220px] text-right text-[10px]" style={{ color: "var(--muted)" }}>
                  Stable filename per filing (ticker + form + date + accession); re-save replaces the same document.
                </span>
              )}
            </div>
          </div>
          {statements.map((s) => (
            <StatementAsPresentedTable key={s.id} stmt={s} />
          ))}
        </div>
      ) : null}

      {!loading && !err && statements.length === 0 ? (
        <Card title="No as-presented statements found">
          <p className="text-sm" style={{ color: "var(--muted2)" }}>
            SEC didn’t return usable as-presented statement linkbases for this filing. Try a different filing.
          </p>
        </Card>
      ) : null}

      <Card title={`MD&A & segment tables (filing HTML) — ${tk}`}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          All <span className="font-medium">HTML tables</span> detected in MD&amp;A (10-K Item 7 / 10-Q Item 2) and in the{" "}
          <span className="font-medium">segment-information style note</span> (e.g. Segment Information, Operating Segments,
          Disaggregated Revenue) after the financial statements item. Single-row bullets, one-cell narrative blocks, and other
          non-grid layout tables are skipped when they have no inline amounts; real grids and any table with{" "}
          <span className="font-mono">ix:nonFraction</span> tags are kept.
        </p>
        {ixLoading ? (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            Loading filing HTML…
          </p>
        ) : ixErr ? (
          <p className="mt-3 text-sm" style={{ color: "var(--warn)" }}>
            {ixErr}
          </p>
        ) : ixbrl?.ok ? (
          <div className="mt-3 space-y-3">
            <p className="text-xs font-mono leading-relaxed" style={{ color: "var(--muted)" }}>
              {ixbrl.selected?.primaryDocument ? `${ixbrl.selected.primaryDocument}` : null}
              {ixbrl.mdnaHeadingFound ? " · MD&A bounds OK" : " · MD&A bounds not detected"}
              {ixbrl.segmentHeadingFound ? " · Segment note heading OK" : " · Segment note heading not detected"}
              {ixbrl.mdnaTableHit ? " · Tables returned" : ""}
            </p>
            {ixbrl.tables.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--muted2)" }}>
                No tables in those sections (unusual headings, or segment note title didn&apos;t match expected patterns).
              </p>
            ) : (
              <div className="space-y-4">
                {ixbrl.tables.map((t) => (
                  <IxbrlHtmlTableCard key={t.id} table={t} />
                ))}
              </div>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
            No data.
          </p>
        )}
      </Card>
    </div>
  );
}

