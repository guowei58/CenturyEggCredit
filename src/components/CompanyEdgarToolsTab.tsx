"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { Card, DataTable } from "@/components/ui";
import { downloadEdgarXbrlExcel } from "@/lib/edgar-xbrl-excel-export";

type EdgarFilingRow = {
  accessionNumber?: string;
  form?: string;
  filingDate?: string;
  description?: string;
  secHomeUrl?: string | null;
  primaryDocUrl?: string | null;
};

type FilingsResponse = {
  error?: string;
  detail?: string | string[];
  ticker?: string;
  companyName?: string;
  cik?: string | null;
  filings?: EdgarFilingRow[];
};

type XbrlBundle = {
  available: boolean;
  facts: Record<string, unknown>[];
  factsTruncated: boolean;
  statements: Record<string, string>;
  statementRecords?: Record<string, Record<string, unknown>[]>;
  rawInstanceUrls: string[];
  error?: string | null;
};

type BundleResponse = {
  ok?: boolean;
  error?: string;
  detail?: string | string[];
  accessionNumber?: string;
  form?: string;
  filingDate?: string;
  company?: string;
  cik?: number | null;
  secHomeUrl?: string | null;
  primaryDocUrl?: string | null;
  html?: string | null;
  htmlTruncated?: boolean;
  htmlChars?: number;
  htmlError?: string | null;
  xbrl?: XbrlBundle;
};

const HTML_PREVIEW_CHARS = 120_000;

function formatDetail(d: string | string[] | undefined): string {
  if (d == null) return "";
  return Array.isArray(d) ? d.join("; ") : d;
}

/** Accession must stay textual (JSON numbers lose precision on 18-digit values). */
function normalizeAccessionFromApi(v: unknown): string {
  if (v == null) return "";
  return String(v)
    .replace(/[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g, "-")
    .trim();
}

export function CompanyEdgarToolsTab({ ticker }: { ticker: string }) {
  const safeTicker = ticker?.trim() ?? "";
  const [filingsRes, setFilingsRes] = useState<FilingsResponse | null>(null);
  const [filingsLoading, setFilingsLoading] = useState(false);
  const [filingsErr, setFilingsErr] = useState<string | null>(null);

  const [bundle, setBundle] = useState<BundleResponse | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);
  const [bundleErr, setBundleErr] = useState<string | null>(null);
  const [viewer, setViewer] = useState<"html" | "facts" | "statements" | "raw">("html");
  const bundlePanelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (bundleLoading || bundle || bundleErr) {
      bundlePanelRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [bundleLoading, bundle, bundleErr]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setFilingsLoading(true);
    setFilingsErr(null);
    setFilingsRes(null);
    setBundle(null);
    setBundleErr(null);
    fetch(`/api/edgartools/filings/${encodeURIComponent(safeTicker)}?limit=60`)
      .then(async (res) => {
        const body = (await res.json()) as FilingsResponse;
        if (!res.ok) {
          const msg =
            body.error ??
            formatDetail(body.detail) ??
            `Failed to load filings (${res.status})`;
          throw new Error(msg);
        }
        return body;
      })
      .then((body) => {
        if (!cancelled) {
          setFilingsRes(body);
          setFilingsErr(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setFilingsErr(e instanceof Error ? e.message : "Failed to load filings");
          setFilingsRes(null);
        }
      })
      .finally(() => {
        if (!cancelled) setFilingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  const loadBundle = (accession: string) => {
    const acc = accession?.trim();
    if (!acc) return;
    setBundleLoading(true);
    setBundleErr(null);
    setBundle(null);
    setViewer("html");
    fetch(`/api/edgartools/filing/bundle?accession=${encodeURIComponent(acc)}`)
      .then(async (res) => {
        const text = await res.text();
        let body: BundleResponse;
        try {
          body = JSON.parse(text) as BundleResponse;
        } catch {
          throw new Error(
            text.startsWith("<")
              ? `Bundle response was not JSON (${res.status}). Is the API route reachable?`
              : (text.slice(0, 400) || `Invalid JSON (${res.status})`)
          );
        }
        if (!res.ok) {
          const msg =
            body.error ??
            formatDetail(body.detail as string | string[] | undefined) ??
            `Bundle failed (${res.status})`;
          throw new Error(msg);
        }
        return body;
      })
      .then((body) => {
        setBundle(body);
        setBundleErr(null);
      })
      .catch((e) => {
        setBundleErr(e instanceof Error ? e.message : "Failed to load filing bundle");
        setBundle(null);
      })
      .finally(() => setBundleLoading(false));
  };

  const htmlPreview = useMemo(() => {
    const h = bundle?.html;
    if (!h) return "";
    if (h.length <= HTML_PREVIEW_CHARS) return h;
    return `${h.slice(0, HTML_PREVIEW_CHARS)}\n\n… [truncated for UI preview; use Copy full HTML]`;
  }, [bundle?.html]);

  const factColumns = useMemo(() => {
    const rows = bundle?.xbrl?.facts ?? [];
    if (!rows.length) return [];
    const keys = new Set<string>();
    for (const row of rows.slice(0, 200)) {
      Object.keys(row).forEach((k) => keys.add(k));
    }
    return Array.from(keys).slice(0, 14);
  }, [bundle?.xbrl?.facts]);

  const canExportXbrlExcel = useMemo(() => {
    const x = bundle?.xbrl;
    if (!x) return false;
    const hasFacts = (x.facts?.length ?? 0) > 0;
    const hasStmtRecs = Object.values(x.statementRecords ?? {}).some((a) => (a?.length ?? 0) > 0);
    const hasStmts = Object.values(x.statements ?? {}).some((v) => (v ?? "").trim().length > 0);
    return hasFacts || hasStmtRecs || hasStmts;
  }, [bundle?.xbrl]);

  if (!safeTicker) {
    return (
      <Card title="EdgarTools SEC">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to browse filings with EdgarTools (HTML + XBRL).
        </p>
      </Card>
    );
  }

  return (
    <Card title={`EdgarTools SEC — ${filingsRes?.companyName ?? safeTicker}`}>
      <p className="text-xs leading-relaxed mb-4" style={{ color: "var(--muted)" }}>
        Powered by the{" "}
        <a
          href="https://github.com/dgunning/edgartools"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--blue)" }}
        >
          edgartools
        </a>{" "}
        Python library. Run the bridge from <span className="font-mono">edgar-bridge/</span> with{" "}
        <span className="font-mono">EDGAR_IDENTITY</span> set (SEC user-agent policy). In development the app
        defaults to <span className="font-mono">http://127.0.0.1:8765</span>; override with{" "}
        <span className="font-mono">EDGAR_TOOLS_BRIDGE_URL</span> in <span className="font-mono">.env.local</span>.
      </p>

      {filingsLoading && (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Loading filings via EdgarTools…
        </p>
      )}
      {filingsErr && (
        <div
          className="rounded border px-3 py-2 text-sm mb-4"
          style={{ borderColor: "var(--border2)", color: "var(--muted2)" }}
        >
          <p className="font-medium" style={{ color: "var(--text)" }}>
            Bridge unavailable or misconfigured
          </p>
          <p className="mt-1">{filingsErr}</p>
          <ol className="mt-2 list-decimal list-inside text-xs space-y-1">
            <li>
              <code className="font-mono">cd edgar-bridge</code> →{" "}
              <code className="font-mono">pip install -r requirements.txt</code>
            </li>
            <li>
              Set <code className="font-mono">EDGAR_IDENTITY=&quot;Your Name you@company.com&quot;</code> (required by SEC)
            </li>
            <li>
              <code className="font-mono">uvicorn main:app --host 127.0.0.1 --port 8765</code>
            </li>
          </ol>
        </div>
      )}

      {filingsRes?.filings && filingsRes.filings.length > 0 && (
        <div className="mb-6">
          <p className="text-[10px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
            Recent filings (select one to load HTML + XBRL)
          </p>
          <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded border" style={{ borderColor: "var(--border2)" }}>
            <DataTable>
              <thead>
                <tr>
                  <th>Form</th>
                  <th>Filed</th>
                  <th>Accession</th>
                  <th>SEC</th>
                  <th>Load</th>
                </tr>
              </thead>
              <tbody>
                {filingsRes.filings.map((f) => {
                  const acc = normalizeAccessionFromApi(f.accessionNumber);
                  return (
                    <tr key={acc || `${f.filingDate}-${f.form}`}>
                      <td className="font-mono text-xs whitespace-nowrap">{f.form}</td>
                      <td className="font-mono text-[11px] whitespace-nowrap">{f.filingDate}</td>
                      <td className="font-mono text-[10px] max-w-[140px] truncate" title={acc}>
                        {acc}
                      </td>
                      <td className="text-xs whitespace-nowrap">
                        {f.secHomeUrl ? (
                          <span className="inline-flex flex-wrap items-center gap-x-1">
                            <a
                              href={f.secHomeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              style={{ color: "var(--blue)" }}
                            >
                              Index
                            </a>
                            {f.primaryDocUrl ? (
                              <SaveFilingLinkButton ticker={safeTicker} url={f.primaryDocUrl} />
                            ) : null}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="text-xs">
                        <button
                          type="button"
                          disabled={!acc || bundleLoading}
                          onClick={() => loadBundle(acc)}
                          className="rounded border px-2 py-1 font-medium transition-colors disabled:opacity-50"
                          style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
                        >
                          HTML / XBRL
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
          </div>
        </div>
      )}

      {filingsRes?.filings?.length === 0 && !filingsLoading && !filingsErr && (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No filings returned for {safeTicker}.
        </p>
      )}

      {/* Scroll target: results sit below the filings table; jump here on load */}
      <div ref={bundlePanelRef} className="scroll-mt-8" style={{ height: 0 }} aria-hidden />

      {bundleLoading && (
        <p className="text-sm font-medium mb-2 py-2 px-2 rounded border" style={{ color: "var(--accent)", borderColor: "var(--border2)", background: "var(--panel)" }}>
          Fetching HTML and XBRL via EdgarTools… Large 10-Ks can take <strong>30–90 seconds</strong> the first time.
        </p>
      )}
      {bundleErr && (
        <p className="text-sm mb-2 py-2 px-2 rounded border" style={{ color: "var(--text)", borderColor: "var(--border2)", background: "var(--panel)" }}>
          {bundleErr}
        </p>
      )}

      {bundle && bundle.accessionNumber != null && bundle.xbrl != null && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-mono" style={{ color: "var(--muted2)" }}>
              {bundle.form} · {bundle.filingDate} · {bundle.accessionNumber}
            </span>
            {bundle.secHomeUrl ? (
              <a href={bundle.secHomeUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--blue)" }}>
                SEC filing index
              </a>
            ) : null}
            {bundle.html ? (
              <button
                type="button"
                className="rounded border px-2 py-0.5 font-mono"
                style={{ borderColor: "var(--border2)" }}
                onClick={() => void navigator.clipboard.writeText(bundle.html ?? "")}
              >
                Copy full HTML
              </button>
            ) : null}
            <button
              type="button"
              disabled={!canExportXbrlExcel}
              title={
                canExportXbrlExcel
                  ? "Download .xlsx: Meta, XBRL facts, and statement tables"
                  : "Load a filing with XBRL facts or statement tables first"
              }
              className="rounded border px-2 py-0.5 font-mono disabled:cursor-not-allowed disabled:opacity-45"
              style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
              onClick={() => {
                const r = downloadEdgarXbrlExcel({
                  ticker: safeTicker,
                  accessionNumber: bundle.accessionNumber,
                  form: bundle.form,
                  filingDate: bundle.filingDate,
                  company: bundle.company ?? undefined,
                  secHomeUrl: bundle.secHomeUrl,
                  xbrl: bundle.xbrl,
                });
                if (!r.ok) window.alert(r.reason);
              }}
            >
              Download Excel (XBRL)
            </button>
          </div>

          <div className="flex flex-wrap gap-1">
            {(
              [
                { id: "html" as const, label: "Primary HTML" },
                { id: "facts" as const, label: `XBRL facts (${bundle.xbrl?.facts?.length ?? 0})` },
                { id: "statements" as const, label: "Statements (tables)" },
                { id: "raw" as const, label: "Raw XBRL URLs" },
              ] as const
            ).map(({ id, label }) => (
              <button
                key={id}
                type="button"
                onClick={() => setViewer(id)}
                className="rounded px-3 py-1 text-xs font-medium transition-colors"
                style={{
                  background: viewer === id ? "var(--accent)" : "transparent",
                  color: viewer === id ? "var(--bg)" : "var(--muted2)",
                  border: "1px solid var(--border2)",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {viewer === "html" && (
            <div>
              {bundle.htmlError ? (
                <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
                  HTML error: {bundle.htmlError}
                </p>
              ) : null}
              {bundle.html ? (
                <>
                  <p className="text-[10px] mb-1" style={{ color: "var(--muted)" }}>
                    Characters returned: {bundle.htmlChars ?? bundle.html.length}
                    {bundle.htmlTruncated ? " (truncated at bridge for JSON size)" : ""}
                    {bundle.html.length > HTML_PREVIEW_CHARS ? " · UI preview capped" : ""}
                  </p>
                  <pre
                    className="text-[11px] leading-snug max-h-[min(480px,55vh)] overflow-auto rounded border p-2 font-mono whitespace-pre-wrap break-words"
                    style={{ borderColor: "var(--border2)", background: "var(--bg)" }}
                  >
                    {htmlPreview}
                  </pre>
                </>
              ) : (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  No primary HTML on this filing.
                </p>
              )}
            </div>
          )}

          {viewer === "facts" && (
            <div>
              {!bundle.xbrl?.available && (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  {bundle.xbrl?.error ?? "No XBRL package for this filing."}
                </p>
              )}
              {bundle.xbrl?.available && (!bundle.xbrl.facts || bundle.xbrl.facts.length === 0) && (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  XBRL is present but no fact grid was exported (try Statements or upgrade edgartools).
                </p>
              )}
              {bundle.xbrl && bundle.xbrl.facts.length > 0 && (
                <>
                  {bundle.xbrl.factsTruncated && (
                    <p className="text-[10px] mb-2" style={{ color: "var(--muted)" }}>
                      Showing first rows only; increase{" "}
                      <span className="font-mono">facts_max</span> on the bridge if needed.
                    </p>
                  )}
                  <div className="overflow-x-auto max-h-[min(420px,50vh)] overflow-y-auto rounded border" style={{ borderColor: "var(--border2)" }}>
                    <DataTable>
                      <thead>
                        <tr>
                          {factColumns.map((c) => (
                            <th key={c} className="text-left text-[10px] font-mono whitespace-nowrap">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {bundle.xbrl.facts.map((row, i) => (
                          <tr key={i}>
                            {factColumns.map((c) => (
                              <td key={c} className="text-[10px] font-mono max-w-[200px] truncate" title={String(row[c] ?? "")}>
                                {row[c] == null ? "" : String(row[c])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </DataTable>
                  </div>
                </>
              )}
            </div>
          )}

          {viewer === "statements" && (
            <div className="space-y-4">
              {!bundle.xbrl?.available ? (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  {bundle.xbrl?.error ?? "No XBRL for statements."}
                </p>
              ) : Object.keys(bundle.xbrl.statements ?? {}).length === 0 ? (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  No statement tables parsed for this filing (form may not expose standard statements here).
                </p>
              ) : (
                (["incomeStatement", "balanceSheet", "cashFlowStatement"] as const).map((k) => {
                  const md = bundle.xbrl?.statements?.[k];
                  if (!md) return null;
                  const title =
                    k === "incomeStatement"
                      ? "Income statement"
                      : k === "balanceSheet"
                        ? "Balance sheet"
                        : "Cash flow statement";
                  return (
                    <div key={k}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
                        {title}
                      </p>
                      <div className="overflow-x-auto rounded border p-3 text-xs leading-relaxed" style={{ borderColor: "var(--border2)" }}>
                        <ReactMarkdown
                          remarkPlugins={[remarkGfm]}
                          components={{
                            table: (p) => <table className="table-institutional text-[11px]">{p.children}</table>,
                            th: (p) => <th className="text-left font-semibold">{p.children}</th>,
                            td: (p) => <td className="align-top">{p.children}</td>,
                          }}
                        >
                          {md}
                        </ReactMarkdown>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {viewer === "raw" && (
            <div>
              {!bundle.xbrl?.rawInstanceUrls?.length ? (
                <p className="text-sm" style={{ color: "var(--muted2)" }}>
                  No .xml / .htm attachment URLs collected. Use the SEC index link for full exhibit list.
                </p>
              ) : (
                <ul className="list-disc list-inside text-xs space-y-1" style={{ color: "var(--blue)" }}>
                  {bundle.xbrl.rawInstanceUrls.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noopener noreferrer">
                        {u}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
