"use client";

import { useCallback, useMemo, useState } from "react";
import { Card, DataTable } from "@/components/ui";

type Variant = "annual" | "quarterly" | "transcript";

type BundleResult = { field: string; ok: boolean; data?: unknown; error?: string };

type SymbolResolution = { tried: string[]; resolved: string };

function isRowArray(x: unknown): x is Record<string, unknown>[] {
  return Array.isArray(x) && x.length > 0 && x.every((r) => r !== null && typeof r === "object" && !Array.isArray(r));
}

/** Roic often returns `[["col1","col2"], ["2017","x"], …]` — first row is headers. */
function isMatrixWithStringHeader(data: unknown): data is unknown[][] {
  if (!Array.isArray(data) || data.length === 0) return false;
  if (!data.every((row) => Array.isArray(row))) return false;
  const head = data[0];
  if (head.length === 0) return false;
  return head.every((cell) => typeof cell === "string");
}

function isNumericLike(v: unknown): boolean {
  if (typeof v === "number" && Number.isFinite(v)) return true;
  if (typeof v === "string") {
    const t = v.trim();
    if (t === "" || t === "—") return false;
    const n = Number(t.replace(/,/g, ""));
    return Number.isFinite(n) && /^-?[\d.,]+(\.\d+)?([eE][+-]?\d+)?$/.test(t.replace(/,/g, ""));
  }
  return false;
}

/** Keep fiscal years, dates, and labels left-aligned even when numeric-looking. */
function columnHeaderIsDimensionKey(header: string): boolean {
  const h = header.toLowerCase();
  return (
    h.includes("year") ||
    h.includes("date") ||
    h.includes("label") ||
    h.includes("quarter") ||
    h.includes("period") ||
    h.endsWith("_id") ||
    h === "symbol" ||
    h === "ticker"
  );
}

function isPrimitiveish(v: unknown): boolean {
  return v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean";
}

/** Single-level unwrap when API nests the payload. */
function unwrapRoicPayload(data: unknown): unknown {
  if (data === null || typeof data !== "object" || Array.isArray(data)) return data;
  const o = data as Record<string, unknown>;
  for (const key of ["data", "rows", "table", "values", "result"] as const) {
    const inner = o[key];
    if (inner !== undefined) return inner;
  }
  return data;
}

function RoicMatrixTable({ matrix }: { matrix: unknown[][] }) {
  const headers = matrix[0] as string[];
  const bodyRows = matrix.slice(1);
  const colCount = headers.length;

  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border2)" }}>
      <DataTable>
        <thead>
          <tr>
            {headers.map((h) => (
              <th
                key={h}
                className="whitespace-nowrap bg-[var(--card2)] px-3 py-2 text-left text-xs font-semibold tracking-wide"
                style={{ color: "var(--text)" }}
              >
                {h.replace(/_/g, " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {bodyRows.length === 0 ? (
            <tr>
              <td colSpan={Math.max(1, colCount)} className="px-3 py-4 text-sm" style={{ color: "var(--muted2)" }}>
                No data rows
              </td>
            </tr>
          ) : (
            bodyRows.map((row, ri) => (
              <tr key={ri} className="transition-colors hover:bg-[var(--card2)]/40">
                {headers.map((h, ci) => {
                  const cell = row[ci];
                  const numeric = isNumericLike(cell) && !columnHeaderIsDimensionKey(h);
                  return (
                    <td
                      key={ci}
                      className={`max-w-[min(28rem,40vw)] px-3 py-1.5 font-mono text-xs ${numeric ? "text-right tabular-nums" : "text-left"}`}
                      style={{ color: "var(--text)" }}
                      title={String(cell ?? "")}
                    >
                      <span className={numeric ? "" : "break-words"}>{formatCell(cell)}</span>
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </DataTable>
    </div>
  );
}

function RoicKeyValueTable({ entries }: { entries: [string, unknown][] }) {
  return (
    <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border2)" }}>
      <DataTable>
        <thead>
          <tr>
            <th className="bg-[var(--card2)] px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--text)" }}>
              Field
            </th>
            <th className="bg-[var(--card2)] px-3 py-2 text-left text-xs font-semibold" style={{ color: "var(--text)" }}>
              Value
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([k, v]) => (
            <tr key={k} className="hover:bg-[var(--card2)]/40">
              <td className="whitespace-nowrap px-3 py-1.5 text-xs font-medium" style={{ color: "var(--muted2)" }}>
                {k.replace(/_/g, " ")}
              </td>
              <td
                className={`max-w-[min(36rem,50vw)] px-3 py-1.5 font-mono text-xs ${isNumericLike(v) ? "text-right tabular-nums" : "text-left break-words"}`}
                style={{ color: "var(--text)" }}
              >
                {formatCell(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
}

function RoicDataBlock({ data }: { data: unknown }) {
  if (data === null || data === undefined) {
    return <p className="text-sm" style={{ color: "var(--muted2)" }}>No data</p>;
  }

  const unwrapped = unwrapRoicPayload(data);

  if (isMatrixWithStringHeader(unwrapped)) {
    return <RoicMatrixTable matrix={unwrapped} />;
  }

  if (isRowArray(unwrapped)) {
    const keys = Object.keys(unwrapped[0] ?? {});
    if (keys.length === 0) {
      return <pre className="max-h-[480px] overflow-auto rounded border p-3 text-xs font-mono">{JSON.stringify(unwrapped, null, 2)}</pre>;
    }
    return (
      <div className="overflow-x-auto rounded-lg border" style={{ borderColor: "var(--border2)" }}>
        <DataTable>
          <thead>
            <tr>
              {keys.map((k) => (
                <th
                  key={k}
                  className="whitespace-nowrap bg-[var(--card2)] px-3 py-2 text-left text-xs font-semibold"
                  style={{ color: "var(--text)" }}
                >
                  {k.replace(/_/g, " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {unwrapped.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--card2)]/40">
                {keys.map((k) => {
                  const cell = row[k];
                  const numeric = isNumericLike(cell) && !columnHeaderIsDimensionKey(k);
                  return (
                    <td
                      key={k}
                      className={`max-w-[min(28rem,40vw)] px-3 py-1.5 font-mono text-xs ${numeric ? "text-right tabular-nums" : "text-left"}`}
                      style={{ color: "var(--text)" }}
                      title={String(cell ?? "")}
                    >
                      {formatCell(cell)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </div>
    );
  }

  if (Array.isArray(unwrapped)) {
    if (unwrapped.length > 0 && unwrapped.every(isPrimitiveish)) {
      return (
        <ul className="list-inside list-disc space-y-1 rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--border2)", color: "var(--text)" }}>
          {unwrapped.map((v, i) => (
            <li key={i} className="font-mono text-xs">
              {formatCell(v)}
            </li>
          ))}
        </ul>
      );
    }
    return <pre className="max-h-[480px] overflow-auto rounded border bg-[var(--card2)]/30 p-3 text-xs font-mono">{JSON.stringify(unwrapped, null, 2)}</pre>;
  }

  if (typeof unwrapped === "string") {
    return (
      <div
        className="max-h-[70vh] overflow-auto rounded-lg border p-4 text-sm leading-relaxed whitespace-pre-wrap"
        style={{ borderColor: "var(--border2)", color: "var(--text)" }}
      >
        {unwrapped}
      </div>
    );
  }

  if (typeof unwrapped === "object" && unwrapped !== null) {
    const entries = Object.entries(unwrapped as Record<string, unknown>);
    const flatEnough =
      entries.length > 0 &&
      entries.length <= 80 &&
      entries.every(([, v]) => isPrimitiveish(v) || (typeof v === "string" && v.length < 500));

    if (flatEnough) {
      return <RoicKeyValueTable entries={entries.sort(([a], [b]) => a.localeCompare(b))} />;
    }
    return <pre className="max-h-[480px] overflow-auto rounded border bg-[var(--card2)]/30 p-3 text-xs font-mono">{JSON.stringify(unwrapped, null, 2)}</pre>;
  }

  return (
    <p className="font-mono text-sm tabular-nums" style={{ color: "var(--text)" }}>
      {formatCell(unwrapped)}
    </p>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: 6 }) : String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  const s = String(v);
  if (typeof v === "string" && /^-?[\d.]+([eE][+-]?\d+)?$/.test(v.trim())) {
    const n = Number(v);
    if (Number.isFinite(n)) return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }
  return s.length > 2000 ? `${s.slice(0, 2000)}…` : s;
}

const TITLES: Record<Variant, string> = {
  annual: "Roic AI — annual financials",
  quarterly: "Roic AI — quarterly financials",
  transcript: "Roic AI — earnings call transcript",
};

export function CompanyRoicAiTab({ ticker, variant }: { ticker: string; variant: Variant }) {
  const safeTicker = ticker?.trim().toUpperCase() ?? "";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bundle, setBundle] = useState<{
    results?: BundleResult[];
    period?: unknown;
    roicSymbol?: string;
    symbolResolution?: SymbolResolution;
  } | null>(null);
  const [transcriptJson, setTranscriptJson] = useState<unknown>(null);
  const [transcriptMeta, setTranscriptMeta] = useState<{ query?: string; fieldId?: string } | null>(null);

  const [startYear, setStartYear] = useState(() => new Date().getUTCFullYear() - 9);
  const [endYear, setEndYear] = useState(() => new Date().getUTCFullYear());
  const [fromQ, setFromQ] = useState("2020Q1");
  const [toQ, setToQ] = useState("2024Q4");
  const [period, setPeriod] = useState("2024Q4");
  const [transcriptField, setTranscriptField] = useState("");
  /** When set, sent as ?symbol= so Roic gets that exact identifier (otherwise the API tries HTZ US, HTZ, HTZ:US, etc.). */
  const [roicSymbolOverride, setRoicSymbolOverride] = useState("");

  const docLink = "https://roic.gitbook.io/api/roic-query-language/getting-started";
  const fieldsLink = "https://roic.ai/knowledge-base/financial-definitions/";

  const fetchBundle = useCallback(
    async (path: string) => {
      setLoading(true);
      setError(null);
      setBundle(null);
      try {
        const res = await fetch(path);
        const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
        if (!res.ok) {
          setError(typeof body?.error === "string" ? body.error : `Request failed (${res.status})`);
          return;
        }
        setBundle(
          body as {
            results?: BundleResult[];
            period?: unknown;
            roicSymbol?: string;
            symbolResolution?: SymbolResolution;
          }
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Request failed");
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const fetchAnnual = useCallback(() => {
    const q = new URLSearchParams({ startYear: String(startYear), endYear: String(endYear) });
    const s = roicSymbolOverride.trim();
    if (s) q.set("symbol", s);
    void fetchBundle(`/api/roic-ai/${encodeURIComponent(safeTicker)}/annual?${q}`);
  }, [fetchBundle, safeTicker, startYear, endYear, roicSymbolOverride]);

  const fetchQuarterly = useCallback(() => {
    const q = new URLSearchParams({ from: fromQ.trim(), to: toQ.trim() });
    const s = roicSymbolOverride.trim();
    if (s) q.set("symbol", s);
    void fetchBundle(`/api/roic-ai/${encodeURIComponent(safeTicker)}/quarterly?${q}`);
  }, [fetchBundle, safeTicker, fromQ, toQ, roicSymbolOverride]);

  const fetchTranscript = useCallback(async () => {
    setLoading(true);
    setError(null);
    setTranscriptJson(null);
    setTranscriptMeta(null);
    const q = new URLSearchParams({ period: period.replace(/\s/g, "").toUpperCase() });
    const f = transcriptField.trim();
    if (f) q.set("field", f);
    const s = roicSymbolOverride.trim();
    if (s) q.set("symbol", s);
    try {
      const res = await fetch(`/api/roic-ai/${encodeURIComponent(safeTicker)}/earnings-transcript?${q}`);
      const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      if (!res.ok) {
        const hint = typeof body?.hint === "string" ? ` ${body.hint}` : "";
        setError(`${typeof body?.error === "string" ? body.error : res.status}${hint}`);
        return;
      }
      setTranscriptJson(body?.data);
      setTranscriptMeta({ query: typeof body?.query === "string" ? body.query : undefined, fieldId: typeof body?.fieldId === "string" ? body.fieldId : undefined });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setLoading(false);
    }
  }, [safeTicker, period, transcriptField, roicSymbolOverride]);

  const failedFields = useMemo(() => (bundle?.results ?? []).filter((r) => !r.ok), [bundle]);

  if (!safeTicker) {
    return (
      <Card title="Roic AI">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Select a company to query Roic AI.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card title={`${TITLES[variant]} — ${safeTicker}`}>
        <p className="mb-4 text-xs leading-relaxed" style={{ color: "var(--muted2)" }}>
          Data is loaded from the{" "}
          <a href={docLink} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            Roic AI RQL API
          </a>
          . Financial field IDs come from the{" "}
          <a href={fieldsLink} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
            financial definitions
          </a>{" "}
          knowledge base. The API allows one field per request; this app runs a small batch of common fields server-side. Configure{" "}
          <code className="rounded bg-[var(--card2)] px-1">ROIC_AI_API_KEY</code> in{" "}
          <code className="rounded bg-[var(--card2)] px-1">.env.local</code>. Symbols are resolved automatically (e.g.{" "}
          <code className="rounded bg-[var(--card2)] px-1">HTZ US</code>, then <code className="rounded bg-[var(--card2)] px-1">HTZ</code>
          ); override below if needed.
        </p>

        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="flex min-w-[200px] max-w-md flex-1 flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
            Roic symbol (optional)
            <input
              value={roicSymbolOverride}
              onChange={(e) => setRoicSymbolOverride(e.target.value)}
              placeholder="Exact symbol from roic.ai quote URL"
              className="rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm"
              style={{ borderColor: "var(--border2)", color: "var(--text)" }}
            />
          </label>
        </div>

        {variant === "annual" && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              Start year
              <input
                type="number"
                value={startYear}
                onChange={(e) => setStartYear(parseInt(e.target.value, 10) || 2000)}
                className="rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              End year
              <input
                type="number"
                value={endYear}
                onChange={(e) => setEndYear(parseInt(e.target.value, 10) || 2000)}
                className="rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <button
              type="button"
              onClick={fetchAnnual}
              disabled={loading}
              className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {loading ? "Loading…" : "Fetch annual"}
            </button>
          </div>
        )}

        {variant === "quarterly" && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              From
              <input
                value={fromQ}
                onChange={(e) => setFromQ(e.target.value)}
                placeholder="2020Q1"
                className="w-28 rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm uppercase"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              To
              <input
                value={toQ}
                onChange={(e) => setToQ(e.target.value)}
                placeholder="2024Q4"
                className="w-28 rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm uppercase"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <button
              type="button"
              onClick={fetchQuarterly}
              disabled={loading}
              className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {loading ? "Loading…" : "Fetch quarterly"}
            </button>
          </div>
        )}

        {variant === "transcript" && (
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              Fiscal quarter
              <input
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2024Q4"
                className="w-28 rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm uppercase"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <label className="flex min-w-[200px] flex-col gap-1 text-xs" style={{ color: "var(--muted2)" }}>
              Field ID (optional)
              <input
                value={transcriptField}
                onChange={(e) => setTranscriptField(e.target.value)}
                placeholder="From knowledge base or .env"
                className="rounded border bg-[var(--card2)] px-2 py-1 font-mono text-sm"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              />
            </label>
            <button
              type="button"
              onClick={() => void fetchTranscript()}
              disabled={loading}
              className="rounded border px-3 py-2 text-sm font-medium disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
            >
              {loading ? "Loading…" : "Fetch transcript"}
            </button>
          </div>
        )}

        {error && (
          <p className="mb-4 rounded border px-3 py-2 text-sm" style={{ borderColor: "var(--danger)", color: "var(--danger)" }}>
            {error}
          </p>
        )}

        {bundle?.roicSymbol && (
          <p className="mb-2 text-[11px] font-mono leading-relaxed" style={{ color: "var(--muted2)" }}>
            Roic symbol: {bundle.roicSymbol} · {JSON.stringify(bundle.period)}
            {bundle.symbolResolution?.tried?.length ? (
              <>
                <br />
                <span className="opacity-90">Tried: {bundle.symbolResolution.tried.join(" → ")}</span>
              </>
            ) : null}
          </p>
        )}

        {failedFields.length > 0 && (
          <p className="mb-3 text-xs leading-relaxed" style={{ color: "var(--warn)" }}>
            Some Roic field IDs failed for this company (wrong id, restatement gap, or missing line). Failed:{" "}
            {failedFields.map((f) => f.field).join(", ")}. Replace defaults with IDs from the{" "}
            <a href={fieldsLink} target="_blank" rel="noopener noreferrer" className="underline" style={{ color: "var(--accent)" }}>
              financial definitions
            </a>{" "}
            list, or set{" "}
            <code className="rounded bg-[var(--card2)] px-1">ROIC_AI_ANNUAL_FIELDS</code> /{" "}
            <code className="rounded bg-[var(--card2)] px-1">ROIC_AI_QUARTERLY_FIELDS</code> in{" "}
            <code className="rounded bg-[var(--card2)] px-1">.env.local</code>.
          </p>
        )}

        {(bundle?.results ?? []).map((r) => (
          <div key={r.field} className="mb-6 last:mb-0">
            <h3 className="mb-2 text-sm font-semibold" style={{ color: "var(--text)" }}>
              {r.field}
              {!r.ok && r.error ? (
                <span className="ml-2 text-xs font-normal" style={{ color: "var(--danger)" }}>
                  {r.error}
                </span>
              ) : null}
            </h3>
            {r.ok && r.data !== undefined ? <RoicDataBlock data={r.data} /> : null}
          </div>
        ))}

        {variant === "transcript" && transcriptMeta?.query && (
          <p className="mb-2 text-[11px] font-mono break-all" style={{ color: "var(--muted2)" }}>
            Query ({transcriptMeta.fieldId}): {transcriptMeta.query}
          </p>
        )}
        {variant === "transcript" && transcriptJson !== null && (
          <RoicDataBlock data={transcriptJson} />
        )}
      </Card>
    </div>
  );
}
