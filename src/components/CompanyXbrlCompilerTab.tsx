"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { compilerStatementRowEmphasis } from "@/lib/sec-ixbrl-face-display";
/* ── types ─────────────────────────────────────────────────────────────── */

type Status = "idle" | "running" | "done" | "error";

type SavedFile = {
  filename: string;
  title: string;
  savedAt: string;
  contentType: string | null;
  isXbrl: boolean;
};

type ModelRow = Record<string, string | number | null>;
type StmtModel = { periods: string[]; rows: ModelRow[] };
type Models = Record<string, { quarterly: StmtModel; annual: StmtModel }>;

type ConflictVal = { value: number; source_file: string; source_sheet: string; source_column: string; raw_concept: string };
type ConflictEntry = { statement_type: string; canonical_row_id: string; period: string; values: ConflictVal[]; resolution: string };
type UnresolvedEntry = {
  source_file: string;
  source_sheet: string;
  statement_type?: string;
  line_label: string;
  concept: string;
  period_label: string;
  reason: string;
};

type ValidationEntry = { check: string; passed: boolean; statement_type: string; canonical_row_id: string; period: string; detail: string };

type Result = {
  ok: boolean;
  compiler_schema_version?: number;
  error?: string;
  elapsed_s?: number;
  master_file?: string;
  files_processed?: number;
  sheets_processed?: number;
  total_facts?: number;
  total_concepts?: number;
  mapped_facts?: number;
  statements_built?: string[];
  derived_facts?: number;
  conflicts_count?: number;
  unresolved_count?: number;
  validation_passed?: number;
  validation_failed?: number;
  inputFileCount?: number;
  /** Optional extra floor for API/UI statement grids; the compiler also starts at the first fiscal year with Q1–Q4 when present. */
  display_models_min_fiscal_year?: number | null;
  models?: Models;
  conflicts_detail?: ConflictEntry[];
  unresolved_detail?: UnresolvedEntry[];
  validation_detail?: ValidationEntry[];
  concept_map_summary?: { stmt: string; raw: string; canon: string; status: string; notes: string }[];
  bs_file_concepts?: Record<string, string[]>;
  coverage_pass?: {
    repaired_mapped_cells: number;
    row_order_registry_rows?: number;
    integrated_unresolved_rows: number;
    integrated_unresolved_cells: number;
    explicit_workbook_rows?: number;
    explicit_workbook_cells?: number;
    workbook_fact_gap_fills?: number;
  };
  final_raw_reconcile?: {
    raw_keys_scanned: number;
    rows_added: number;
    maps_repaired: number;
    orphan_master_rows_recovered: number;
    cells_added: number;
  };
};

const COMPILER_SCHEMA_VERSION = 2;

type RenderableCompiledResult = Result & {
  ok: true;
  compiler_schema_version: typeof COMPILER_SCHEMA_VERSION;
  models: Models;
};

function isRenderableCompiledResult(
  result: Result | null | undefined
): result is RenderableCompiledResult {
  return Boolean(
    result &&
      result.ok &&
      result.compiler_schema_version === COMPILER_SCHEMA_VERSION &&
      result.models &&
      Object.keys(result.models).length > 0
  );
}

type ViewMode = "quarterly" | "annual";

export type CompanyXbrlCompilerTabHandle = {
  startCompile: () => void;
};

export type CompileUiState = {
  canCompile: boolean;
  compiling: boolean;
};

const STMT_LABEL: Record<string, string> = {
  income_statement: "Income Statement",
  balance_sheet: "Balance Sheet",
  cash_flow: "Cash Flow Statement",
};

const STMT_ORDER = ["income_statement", "balance_sheet", "cash_flow"];

function fmt(v: unknown): string {
  if (v == null) return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ── per-ticker result cache (survives tab switches) ──────────────────── */

const _resultCache = new Map<string, Result>();

/* ── Excel download ───────────────────────────────────────────────────── */

const CLR_SECTION_BG = "FF1F4E79";
const CLR_SECTION_FT = "FFFFFFFF";
const CLR_HEADER_BG = "FF4472C4";
const CLR_HEADER_FT = "FFFFFFFF";
const CLR_SUBTOTAL_BG = "FFD9E2F3";
const CLR_ALT_ROW = "FFF2F2F2";
const NUM_FMT = '#,##0.00_);(#,##0.00);"-"';

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds the workbook for browser download / Saved Documents (quarterly sheets only; FY columns stay in quarterly grid). */
async function buildCompiledExcelBlob(
  ticker: string,
  result: Result
): Promise<{ blob: Blob; downloadFilename: string } | null> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "CenturyEggCredit XBRL Compiler";

  const models = result.models;
  if (!models) return null;

  const thin = { style: "thin" as const, color: { argb: "FFB4B4B4" } };
  const borderAll = { top: thin, bottom: thin, left: thin, right: thin };

  for (const stmtKey of STMT_ORDER) {
    const stmtData = models[stmtKey];
    if (!stmtData) continue;

    const label = STMT_LABEL[stmtKey] || stmtKey;

    /* Annual tabs are omitted from the file — quarterly periods include FY## columns when present. */
    for (const mode of ["quarterly"] as const) {
      const m = stmtData[mode];
      if (!m || !m.rows.length) continue;

      const sheetName = `${label.replace("Statement", "Stmt")}`.slice(0, 31);
      const ws = wb.addWorksheet(sheetName);

      const periods = m.periods;
      const colCount = periods.length + 1;

      // ── Title row ──
      const titleRow = ws.addRow([`${ticker.toUpperCase()} — ${label}`]);
      titleRow.font = { bold: true, size: 12, color: { argb: CLR_SECTION_FT } };
      ws.mergeCells(titleRow.number, 1, titleRow.number, colCount);
      const titleCell = ws.getCell(titleRow.number, 1);
      titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_SECTION_BG } };
      titleCell.alignment = { horizontal: "left", vertical: "middle" };
      titleRow.height = 22;

      // ── Blank row ──
      ws.addRow([]);

      // ── Header row ──
      const headerRow = ws.addRow(["Line Item", ...periods]);
      headerRow.eachCell((cell, colNumber) => {
        cell.font = { bold: true, size: 9, color: { argb: CLR_HEADER_FT } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_HEADER_BG } };
        cell.border = borderAll;
        cell.alignment = colNumber === 1
          ? { horizontal: "left", vertical: "middle" }
          : { horizontal: "right", vertical: "middle" };
      });
      headerRow.height = 18;

      // ── Detect year boundaries for column grouping ──
      const yearBoundaries = new Set<number>();
      for (let i = 1; i < periods.length; i++) {
        const prev = periods[i - 1].replace(/\D/g, "");
        const cur = periods[i].replace(/\D/g, "");
        if (prev && cur && prev !== cur && periods[i].startsWith("1Q")) {
          yearBoundaries.add(i + 2); // +2 because col 1 is line items and 1-indexed
        }
      }

      // ── Data rows ──
      for (let ri = 0; ri < m.rows.length; ri++) {
        const row = m.rows[ri];
        const lineLabel = String(row.line || row.concept || "");
        const depth = typeof row.depth === "number" ? row.depth : 0;

        const vals: (string | number | null)[] = [lineLabel];
        for (const p of periods) {
          const v = row[p];
          vals.push(v == null ? null : Number(v));
        }

        const dataRow = ws.addRow(vals);

        const emphasis = compilerStatementRowEmphasis(lineLabel, stmtKey);
        const isSubtotal = emphasis === "subtotal";

        dataRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
          cell.border = borderAll;
          cell.font = { size: 9, bold: isSubtotal };

          if (colNumber === 1) {
            cell.alignment = { horizontal: "left", vertical: "middle", indent: Math.max(0, depth - 1) };
          } else {
            cell.alignment = { horizontal: "right", vertical: "middle" };
            if (typeof cell.value === "number") {
              cell.numFmt = NUM_FMT;
            }
          }

          if (isSubtotal) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_SUBTOTAL_BG } };
          } else if (ri % 2 === 1) {
            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CLR_ALT_ROW } };
          }
        });
      }

      // ── Column widths ──
      ws.getColumn(1).width = 38;
      for (let ci = 2; ci <= colCount; ci++) {
        ws.getColumn(ci).width = 12;
      }

      // Freeze the first column and header row
      ws.views = [{ state: "frozen", xSplit: 1, ySplit: 3 }];
    }
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const stamp = new Date().toISOString().slice(0, 10);
  const downloadFilename = `${ticker.toUpperCase()}_XBRL-compiled-financials_${stamp}.xlsx`;
  return { blob, downloadFilename };
}

/* ── statement table ───────────────────────────────────────────────────── */

const STICKY_SHADOW = "4px 0 8px -2px rgba(0,0,0,0.25)";

function Table({
  title,
  model,
  statementKey,
}: {
  title: string;
  model: StmtModel;
  statementKey: string;
}) {
  if (!model || !model.rows.length) {
    return (
      <div className="rounded border border-dashed p-4 text-center text-xs"
        style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>
        No data for {title}.
      </div>
    );
  }
  return (
    <div className="mb-6">
      <h4 className="mb-2 text-xs font-bold tracking-wide uppercase" style={{ color: "var(--accent)" }}>{title}</h4>
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
        <table className="w-full border-collapse text-[11px]" style={{ tableLayout: "auto" }}>
          <thead>
            <tr>
              <th className="sticky left-0 z-20 min-w-[220px] max-w-[280px] px-3 py-1.5 text-left font-semibold border-b border-r"
                style={{
                  background: "var(--sb)",
                  borderColor: "var(--border)",
                  color: "var(--muted)",
                  boxShadow: STICKY_SHADOW,
                }}>
                Line
              </th>
              {model.periods.map((p) => (
                <th key={p} className="min-w-[76px] px-2 py-1.5 text-right font-semibold border-b whitespace-nowrap"
                  style={{ background: "var(--sb)", borderColor: "var(--border)", color: "var(--muted)" }}>
                  {p}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((row, i) => {
              const lineLabel = String(row.line || row.concept);
              const emphasis = compilerStatementRowEmphasis(lineLabel, statementKey);
              const depth = typeof row.depth === "number" ? row.depth : 0;
              const rowBg =
                emphasis === "subtotal"
                  ? "color-mix(in srgb, var(--accent) 11%, var(--panel))"
                  : emphasis === "heading"
                    ? "color-mix(in srgb, var(--muted) 7%, var(--panel))"
                    : i % 2 === 1
                      ? "color-mix(in srgb, var(--muted) 4%, var(--panel))"
                      : "var(--panel)";
              const labelWeight = emphasis === "normal" ? 400 : 600;
              const valueWeight = emphasis === "subtotal" ? 600 : 400;
              const labelColor = emphasis === "heading" ? "var(--muted2)" : "var(--text)";
              return (
                <tr
                  key={`${row.concept}-${i}`}
                  className="border-b"
                  style={{
                    borderColor:
                      emphasis === "subtotal"
                        ? "color-mix(in srgb, var(--accent) 28%, var(--border2))"
                        : "var(--border2)",
                    background: rowBg,
                  }}
                >
                  <td
                    className="sticky left-0 z-10 min-w-[220px] max-w-[280px] border-r truncate px-3 py-1"
                    style={{
                      background: rowBg,
                      color: labelColor,
                      fontWeight: labelWeight,
                      borderColor: "var(--border)",
                      boxShadow: STICKY_SHADOW,
                      paddingLeft: `${10 + Math.min(10, depth) * 14}px`,
                      fontStyle: emphasis === "heading" ? "italic" : "normal",
                    }}
                    title={lineLabel}
                  >
                    {lineLabel}
                  </td>
                  {model.periods.map((p) => {
                    const v = row[p];
                    return (
                      <td
                        key={p}
                        className="whitespace-nowrap px-2 py-1 text-right tabular-nums"
                        style={{
                          color: emphasis === "heading" ? "var(--muted)" : "var(--text)",
                          fontWeight: valueWeight,
                        }}
                      >
                        {fmt(v)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── statements panel ──────────────────────────────────────────────────── */

function StatementsPanel({
  result,
  ticker,
}: {
  result: Result | null;
  ticker: string;
}) {
  const { data: session } = useSession();
  const [mode, setMode] = useState<ViewMode>("quarterly");
  const [active, setActive] = useState("");
  const [downloading, setDownloading] = useState(false);
  const [savedDocLine, setSavedDocLine] = useState<{ ok: boolean; text: string } | null>(null);
  const models = result?.models;
  const stmts = STMT_ORDER.filter((s) => models?.[s]);

  useEffect(() => {
    if (stmts.length && !stmts.includes(active)) setActive(stmts[0]);
  }, [stmts, active]);

  const handleDownload = useCallback(async () => {
    if (!result) return;
    setDownloading(true);
    setSavedDocLine(null);
    try {
      const built = await buildCompiledExcelBlob(ticker, result);
      if (!built) return;
      triggerBrowserDownload(built.blob, built.downloadFilename);
      if (session?.user) {
        const fd = new FormData();
        fd.append("action", "save-xbrl-compiler-xlsx");
        fd.append("file", built.blob, built.downloadFilename);
        const res = await fetch(`/api/saved-documents/${encodeURIComponent(ticker)}`, { method: "POST", body: fd });
        const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
        if (res.ok && j.ok) {
          setSavedDocLine({ ok: true, text: "Also saved to Saved Documents (latest model replaces the prior file for this ticker)." });
        } else {
          setSavedDocLine({
            ok: false,
            text: typeof j.error === "string" ? j.error : "Could not save a copy to Saved Documents.",
          });
        }
      }
    } catch (e) {
      console.error("Excel download failed:", e);
    } finally {
      setDownloading(false);
    }
  }, [result, ticker, session?.user]);

  if (!result?.ok || !models || !stmts.length) {
    return null;
  }

  const m = models[active]?.[mode];
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
          {stmts.map((s) => (
            <button key={s} type="button" onClick={() => setActive(s)}
              className="px-3 py-1 text-[10px] font-semibold transition-colors"
              style={active === s ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)", background: "var(--sb)" }}>
              {STMT_LABEL[s] || s}
            </button>
          ))}
        </div>
        <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
          {(["quarterly", "annual"] as ViewMode[]).map((v) => (
            <button key={v} type="button" onClick={() => setMode(v)}
              className="px-3 py-1 text-[10px] font-semibold transition-colors capitalize"
              style={mode === v ? { background: "var(--accent)", color: "#fff" } : { color: "var(--muted)", background: "var(--sb)" }}>
              {v}
            </button>
          ))}
        </div>
        <button type="button" onClick={handleDownload} disabled={downloading}
          className="ml-auto flex items-center gap-1.5 rounded-lg border px-3 py-1 text-[10px] font-semibold transition-colors hover:opacity-80 disabled:opacity-40"
          style={{ borderColor: "var(--border2)", color: "var(--accent)", background: "var(--card)" }}>
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M8 1v9m0 0L5 7m3 3 3-3M2 12v1a2 2 0 002 2h8a2 2 0 002-2v-1"
              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {downloading ? "Generating…" : "Download Excel"}
        </button>
      </div>
      {savedDocLine ? (
        <p className="text-[10px] leading-snug" style={{ color: savedDocLine.ok ? "var(--accent)" : "var(--warn)" }}>
          {savedDocLine.text}
        </p>
      ) : null}
      {m ? (
        <Table title={`${STMT_LABEL[active] || active} – ${mode}`} model={m} statementKey={active} />
      ) : (
        <div className="text-xs" style={{ color: "var(--muted2)" }}>No {mode} data.</div>
      )}
    </div>
  );
}

/* ── conflicts panel ───────────────────────────────────────────────────── */

function ValidationPanel({ result }: { result: Result | null }) {
  const vfails = result?.validation_detail ?? [];
  if (!result?.ok) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-xs"
      style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>Compile first.</div>;
  }
  return (
    <div>
      <h4 className="text-xs font-bold mb-2"
        style={{ color: vfails.length ? "#ef4444" : "var(--accent)" }}>
        {vfails.length} Tie-out Failure{vfails.length !== 1 ? "s" : ""}
      </h4>
      {!vfails.length ? (
        <div className="text-xs" style={{ color: "var(--muted)" }}>All checks passed.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
          <table className="w-full border-collapse text-[11px]">
            <thead>
              <tr>
                {["Check", "Statement", "Row", "Period", "Detail"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-semibold border-b"
                    style={{ background: "var(--sb)", borderColor: "var(--border)", color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vfails.map((v, i) => (
                <tr key={i} className="border-b" style={{ borderColor: "var(--border2)" }}>
                  <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "#ef4444" }}>{v.check}</td>
                  <td className="px-2 py-1" style={{ color: "var(--text)" }}>{STMT_LABEL[v.statement_type] || v.statement_type}</td>
                  <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--accent)" }}>{v.canonical_row_id}</td>
                  <td className="px-2 py-1">{v.period}</td>
                  <td className="px-2 py-1 text-[10px]" style={{ color: "var(--muted)" }}>{v.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ConflictsPanel({ result }: { result: Result | null }) {
  const conflicts = result?.conflicts_detail ?? [];
  const unresolved = result?.unresolved_detail ?? [];

  if (!result?.ok) {
    return <div className="rounded-lg border border-dashed p-8 text-center text-xs"
      style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}>Compile first.</div>;
  }

  return (
    <div className="space-y-6">
      <ValidationPanel result={result} />
      <div>
        <h4 className="text-xs font-bold mb-2"
          style={{ color: conflicts.length ? "#f59e0b" : "var(--accent)" }}>
          {conflicts.length} Conflict{conflicts.length !== 1 ? "s" : ""}
        </h4>
        {!conflicts.length ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>None.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {["Statement", "Row ID", "Period", "Values", "Resolution"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-semibold border-b"
                      style={{ background: "var(--sb)", borderColor: "var(--border)", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "var(--border2)" }}>
                    <td className="px-2 py-1" style={{ color: "var(--text)" }}>{STMT_LABEL[c.statement_type] || c.statement_type}</td>
                    <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--accent)" }}>{c.canonical_row_id}</td>
                    <td className="px-2 py-1">{c.period}</td>
                    <td className="px-2 py-1 text-[10px]">
                      {c.values.map((v, j) => (
                        <div key={j}>{fmt(v.value)} <span style={{ color: "var(--muted2)" }}>({v.source_file})</span></div>
                      ))}
                    </td>
                    <td className="px-2 py-1 text-[10px]" style={{ color: "var(--muted)" }}>{c.resolution}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h4 className="text-xs font-bold mb-2"
          style={{ color: unresolved.length ? "#f59e0b" : "var(--accent)" }}>
          {unresolved.length} Unresolved Row{unresolved.length !== 1 ? "s" : ""}
        </h4>
        {!unresolved.length ? (
          <div className="text-xs" style={{ color: "var(--muted)" }}>All rows mapped.</div>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)" }}>
            <table className="w-full border-collapse text-[11px]">
              <thead>
                <tr>
                  {["File", "Sheet", "Stmt", "Line", "Concept", "Period", "Reason"].map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-semibold border-b"
                      style={{ background: "var(--sb)", borderColor: "var(--border)", color: "var(--muted)" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {unresolved.map((u, i) => (
                  <tr key={i} className="border-b" style={{ borderColor: "var(--border2)" }}>
                    <td className="px-2 py-1 text-[10px]">{u.source_file}</td>
                    <td className="px-2 py-1">{u.source_sheet}</td>
                    <td className="px-2 py-1 text-[10px]" style={{ color: "var(--muted2)" }}>
                      {u.statement_type ? (STMT_LABEL[u.statement_type] ?? u.statement_type) : "—"}
                    </td>
                    <td className="px-2 py-1">{u.line_label}</td>
                    <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--accent)" }}>{u.concept}</td>
                    <td className="px-2 py-1">{u.period_label}</td>
                    <td className="px-2 py-1 text-[10px]" style={{ color: "var(--muted2)" }}>{u.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

/* ── diagnostics panel ─────────────────────────────────────────────────── */

function DiagnosticsPanel({ result }: { result: Result | null }) {
  const [stmtFilter, setStmtFilter] = useState("balance_sheet");
  const [search, setSearch] = useState("");

  const cm = result?.concept_map_summary ?? [];
  const bsFiles = result?.bs_file_concepts ?? {};

  const stmtTypes = Array.from(new Set(cm.map((c) => c.stmt))).sort();
  const filtered = cm.filter((c) => {
    if (c.stmt !== stmtFilter) return false;
    if (!search) return true;
    const q = search.toLowerCase();
    return c.raw.toLowerCase().includes(q) || c.canon.toLowerCase().includes(q) || c.notes.toLowerCase().includes(q);
  });

  const statusColor: Record<string, string> = {
    auto_from_master: "#22c55e",
    auto_local_name: "#3b82f6",
    auto_label_match: "#8b5cf6",
    ai_matched: "#f59e0b",
    auto_from_filing: "#ef4444",
  };

  return (
    <div className="space-y-4">
      <div>
        <h4 className="text-xs font-bold mb-2" style={{ color: "var(--accent)" }}>Concept Mapping Diagnostics</h4>
        <p className="text-[10px] mb-3" style={{ color: "var(--muted2)" }}>
          Shows how every raw XBRL concept was mapped to a canonical row. Use the search box to find specific concepts.
        </p>
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className="flex rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
            {stmtTypes.map((s) => (
              <button key={s} type="button" onClick={() => setStmtFilter(s)}
                className="px-3 py-1 text-[10px] font-semibold transition-colors"
                style={stmtFilter === s
                  ? { background: "var(--accent)", color: "#fff" }
                  : { color: "var(--muted)", background: "var(--sb)" }}>
                {s.replace(/_/g, " ")}
              </button>
            ))}
          </div>
          <input
            type="text" placeholder="Search concepts…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="rounded border px-2 py-1 text-[10px]"
            style={{ borderColor: "var(--border2)", background: "var(--sb)", color: "var(--fg)", minWidth: 200 }}
          />
          <span className="text-[10px]" style={{ color: "var(--muted2)" }}>{filtered.length} mappings</span>
        </div>
        <div className="flex gap-3 flex-wrap mb-3">
          {Object.entries(statusColor).map(([k, v]) => (
            <span key={k} className="flex items-center gap-1 text-[10px]">
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: v }} />
              <span style={{ color: "var(--muted2)" }}>{k.replace(/_/g, " ")}</span>
            </span>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border)", maxHeight: 500 }}>
          <table className="w-full border-collapse text-[11px]">
            <thead className="sticky top-0" style={{ zIndex: 1 }}>
              <tr>
                {["Raw Concept", "Canonical Row", "Status", "Notes"].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-left font-semibold border-b"
                    style={{ background: "var(--sb)", borderColor: "var(--border)", color: "var(--muted)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={i} className="border-b" style={{ borderColor: "var(--border2)" }}>
                  <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--fg)" }}>{c.raw}</td>
                  <td className="px-2 py-1 font-mono text-[10px]" style={{ color: "var(--accent)" }}>{c.canon}</td>
                  <td className="px-2 py-1">
                    <span className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold"
                      style={{ background: `${statusColor[c.status] ?? "#666"}22`, color: statusColor[c.status] ?? "#666" }}>
                      {c.status.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="px-2 py-1 text-[10px]" style={{ color: "var(--muted2)" }}>{c.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {Object.keys(bsFiles).length > 0 && stmtFilter === "balance_sheet" && (
        <div>
          <h4 className="text-xs font-bold mb-2" style={{ color: "var(--accent)" }}>Balance Sheet Concepts by File</h4>
          <p className="text-[10px] mb-3" style={{ color: "var(--muted2)" }}>
            All raw XBRL concepts found in each file&apos;s Balance Sheet tab. Useful for finding concepts that may have been dropped or remapped.
          </p>
          <div className="space-y-3">
            {Object.entries(bsFiles).sort().map(([file, concepts]) => (
              <details key={file} className="rounded-lg border" style={{ borderColor: "var(--border2)" }}>
                <summary className="cursor-pointer px-3 py-2 text-[11px] font-semibold" style={{ color: "var(--fg)", background: "var(--sb)" }}>
                  {file} <span className="font-normal" style={{ color: "var(--muted2)" }}>({concepts.length} concepts)</span>
                </summary>
                <div className="px-3 py-2 max-h-[300px] overflow-y-auto">
                  {concepts.filter(Boolean).map((c, i) => {
                    const isMapped = cm.some((m) => m.stmt === "balance_sheet" && m.raw === c);
                    const mapping = cm.find((m) => m.stmt === "balance_sheet" && m.raw === c);
                    return (
                      <div key={i} className="flex items-center gap-2 py-0.5 text-[10px] font-mono">
                        <span className="w-2 h-2 rounded-full flex-shrink-0"
                          style={{ background: isMapped ? (statusColor[mapping?.status ?? ""] ?? "#22c55e") : "#ef4444" }} />
                        <span style={{ color: isMapped ? "var(--fg)" : "#ef4444" }}>{c}</span>
                        {mapping && mapping.raw !== mapping.canon && (
                          <span style={{ color: "var(--muted2)" }}>→ {mapping.canon}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── main component ────────────────────────────────────────────────────── */

export const CompanyXbrlCompilerTab = forwardRef<
  CompanyXbrlCompilerTabHandle,
  {
    ticker: string;
    /** Increment when Saved Documents gain new SEC-XBRL workbooks (e.g. after bulk save). */
    savedDocumentsRev?: number;
    onCompileUiChange?: (state: CompileUiState) => void;
  }
>(function CompanyXbrlCompilerTab({ ticker, savedDocumentsRev = 0, onCompileUiChange }, ref) {
  const { data: session, status: sessionStatus } = useSession();
  const [status, setStatus] = useState<Status>("idle");
  const [result, setResult] = useState<Result | null>(() => _resultCache.get(ticker) ?? null);
  const [files, setFiles] = useState<SavedFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [filesLoadError, setFilesLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const loadedRef = useRef("");

  // Restore from cache on ticker change
  useEffect(() => {
    const cached = _resultCache.get(ticker);
    if (isRenderableCompiledResult(cached)) {
      setResult(cached);
      setStatus(cached.ok ? "done" : "error");
    } else {
      if (cached) _resultCache.delete(ticker);
      setResult(null);
      setStatus("idle");
    }
  }, [ticker]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    const uid = session?.user?.id;
    if (!uid || !ticker) {
      loadedRef.current = "";
      setLoading(false);
      setFiles([]);
      setSelected(new Set());
      setFilesLoadError(
        !uid ? "Sign in to load saved workbooks and run the compiler." : null
      );
      return;
    }
    const slot = `${uid}:${ticker}:${savedDocumentsRev}`;
    if (loadedRef.current === slot) return;
    loadedRef.current = slot;
    setLoading(true);
    setFilesLoadError(null);
    void fetch(`/api/xbrl-compiler/${encodeURIComponent(ticker)}`, { credentials: "include", cache: "no-store" })
      .then(async (r) => {
        const j = (await r.json()) as {
          error?: string;
          allFiles?: Record<string, unknown>[];
          lastCompiledResult?: Result;
        };
        if (!r.ok) {
          setFiles([]);
          setSelected(new Set());
          setFilesLoadError(j.error ?? `Could not load saved workbooks (HTTP ${r.status})`);
          return;
        }
        const list: SavedFile[] = (j.allFiles ?? []).map((f) => ({
          filename: String(f.filename ?? ""),
          title: String(f.title ?? ""),
          savedAt: String(f.savedAt ?? ""),
          contentType: f.contentType ? String(f.contentType) : null,
          isXbrl: Boolean(f.isXbrl ?? (f as { isCompilerSource?: unknown }).isCompilerSource),
        }));
        setFiles(list);
        setSelected(new Set(list.filter((f) => f.isXbrl).map((f) => f.filename)));

        const last = j.lastCompiledResult;
        // Only hydrate compiled statements from server on first load per rev cycle — not after bulk-save refetch (would jump tabs).
        if (savedDocumentsRev === 0 && isRenderableCompiledResult(last)) {
          setResult(last);
          _resultCache.set(ticker, last);
          setStatus("done");
        }
      })
      .catch((e) => {
        setFiles([]);
        setSelected(new Set());
        setFilesLoadError(e instanceof Error ? e.message : "Could not load saved workbooks");
      })
      .finally(() => setLoading(false));
  }, [session?.user?.id, sessionStatus, ticker, savedDocumentsRev]);

  const compile = useCallback(async () => {
    if (filesLoadError) return;
    const xbrlSelected = [...selected].filter((f) =>
      files.some((file) => file.isXbrl && file.filename === f)
    );
    if (!xbrlSelected.length) return;

    setStatus("running");
    setResult(null);
    _resultCache.delete(ticker);
    try {
      const res = await fetch(`/api/xbrl-compiler/${encodeURIComponent(ticker)}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selectedFiles: xbrlSelected }),
      });
      const j = (await res.json()) as Result & { error?: string };
      let outcome: Result = j;
      if (!res.ok && !outcome.ok) {
        outcome = { ok: false, error: outcome.error ?? `Compile request failed (HTTP ${res.status})` };
      } else if (outcome.ok && !isRenderableCompiledResult(outcome)) {
        const built = outcome.statements_built?.length
          ? outcome.statements_built.join(", ")
          : "none";
        const schema =
          outcome.compiler_schema_version != null
            ? ` (schema v${outcome.compiler_schema_version})`
            : "";
        outcome = {
          ok: false,
          error:
            outcome.error ??
            `Compiler finished but returned no statement grids${schema} (statements built: ${built}). This often means the server could not read the full compile result — try fewer workbooks or re-run. If it persists, re-save workbooks in Step 1.`,
        };
      }
      setResult(outcome);
      setStatus(outcome.ok ? "done" : "error");
      if (outcome.ok) {
        _resultCache.set(ticker, outcome);
      }
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : "Compile failed" });
      setStatus("error");
    }
  }, [ticker, selected, files, filesLoadError]);

  useImperativeHandle(ref, () => ({ startCompile: () => void compile() }), [compile]);

  const xbrlSelectedCount = [...selected].filter((f) =>
    files.some((file) => file.isXbrl && file.filename === f)
  ).length;

  const canCompile =
    !filesLoadError &&
    !loading &&
    status !== "running" &&
    xbrlSelectedCount > 0;

  useEffect(() => {
    onCompileUiChange?.({ canCompile, compiling: status === "running" });
  }, [canCompile, onCompileUiChange, status]);

  const hasStmts = isRenderableCompiledResult(result);

  return (
    <div className="space-y-3">
      {loading ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Loading saved workbooks…
        </p>
      ) : null}
      {filesLoadError ? (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          {filesLoadError}
        </p>
      ) : null}
      {!loading && !filesLoadError && xbrlSelectedCount === 0 ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No saved workbooks yet. Complete step 1 first.
        </p>
      ) : null}
      {status === "running" ? (
        <p className="text-sm" style={{ color: "var(--accent)" }}>
          Compiling {ticker}… This may take a few minutes.
        </p>
      ) : null}
      {status === "error" && result?.error ? (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          {result.error}
        </p>
      ) : null}
      {hasStmts ? (
        <StatementsPanel result={result} ticker={ticker} />
      ) : status !== "running" && !loading && !filesLoadError && xbrlSelectedCount > 0 ? (
        <p className="py-8 text-center text-sm" style={{ color: "var(--muted2)" }}>
          Hit compile to view the statements.
        </p>
      ) : null}
    </div>
  );
});
