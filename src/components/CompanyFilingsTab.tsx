"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { Card, DataTable } from "@/components/ui";
import { normalizeCikInput } from "@/lib/sec-edgar";

type Filing = { form: string; filingDate: string; description: string; docUrl: string };

type SecFilingsResult = {
  companyName: string;
  cik: string;
  filings: Filing[];
};

type QuickFilter = "all" | "10k10q" | "8k" | "proxy" | "prospectus";

type LookupHit = { cik: string; ticker: string; title: string };

type RelatedFilerRow = {
  cik: string;
  ticker: string;
  entityName: string;
  filingCount: number;
};

function looksLikeCikOnlyInput(t: string): boolean {
  const trimmed = t.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 4 || digits.length > 10) return false;
  return trimmed.replace(/[\d\s.\-]/g, "") === "";
}

function normForm(form: string): string {
  return (form || "").trim().toUpperCase();
}

function is10K10Q(form: string): boolean {
  const n = normForm(form);
  return n === "10-K" || n === "10-K/A" || n === "10-Q" || n === "10-Q/A";
}

function is8K(form: string): boolean {
  const n = normForm(form);
  return n === "8-K" || n === "8-K/A";
}

function isProxy(form: string): boolean {
  const n = normForm(form);
  return (
    n === "DEF 14A" ||
    n === "DEFA14A" ||
    n === "PRE 14A" ||
    n === "PREA14A" ||
    n.includes("14A")
  );
}

/** Statutory prospectuses (424B*), related registration statements, and common fund prospectus forms. */
function isProspectus(form: string): boolean {
  const n = normForm(form);
  if (n.startsWith("424B")) return true;
  if (n === "424H") return true;
  if (n === "497" || n.startsWith("497")) return true;
  if (n === "S-1" || n === "S-1/A") return true;
  if (n === "S-3" || n === "S-3/A") return true;
  if (n === "S-4" || n === "S-4/A") return true;
  if (n === "S-11" || n === "S-11/A") return true;
  if (n === "F-1" || n === "F-1/A") return true;
  if (n === "F-3" || n === "F-3/A") return true;
  if (n === "F-4" || n === "F-4/A") return true;
  return false;
}

function matchQuickFilter(filing: Filing, filter: QuickFilter): boolean {
  if (filter === "all") return true;
  if (filter === "10k10q") return is10K10Q(filing.form);
  if (filter === "8k") return is8K(filing.form);
  if (filter === "proxy") return isProxy(filing.form);
  if (filter === "prospectus") return isProspectus(filing.form);
  return true;
}

/**
 * Return a short, useful summary for the filing (form + SEC description when helpful).
 */
function getFilingSummary(form: string, filingDate: string, secDescription: string): string {
  const f = (form || "").trim().toUpperCase();
  const desc = (secDescription || "").trim().replace(/\s+/g, " ");
  const hasUsefulDesc = desc.length > 0 && desc.length < 120;

  if (f === "10-K" || f === "10-K/A") return "Annual report";
  if (f === "10-Q" || f === "10-Q/A") return "Quarterly report";
  if (f === "8-K" || f === "8-K/A") {
    if (hasUsefulDesc && /ITEM\s*\d/i.test(desc)) {
      const itemMatch = desc.match(/ITEM\s*(\d+\.?\d*)\s*[—\-:]?\s*(.+)/i) ?? desc.match(/ITEM\s*(\d+\.?\d*)\s+(.+)/i);
      if (itemMatch) {
        const rest = itemMatch[2].trim().replace(/\s+/g, " ");
        return rest.length > 48 ? `Item ${itemMatch[1]} — ${rest.slice(0, 48)}…` : `Item ${itemMatch[1]} — ${rest}`;
      }
      return desc.slice(0, 56) + (desc.length > 56 ? "…" : "");
    }
    return "Current report";
  }
  if (f === "DEF 14A" || f === "DEFA14A") return "Proxy statement (definitive)";
  if (f === "PRE 14A" || f === "PREA14A") return "Preliminary proxy statement";
  if (f.includes("14A")) return hasUsefulDesc ? desc.slice(0, 60) + (desc.length > 60 ? "…" : "") : "Proxy / information statement";
  if (f.startsWith("424B")) return "Prospectus";
  if (f === "424H") return "Prospectus (Rule 424(h))";
  if (f.startsWith("497")) return "Prospectus (registered fund)";
  if (f === "S-1" || f === "S-1/A") return "Registration statement (IPO / primary)";
  if (f === "S-3" || f === "S-3/A") return "Shelf registration statement";
  if (f === "S-4" || f === "S-4/A") return "Registration (M&A / exchange offer)";
  if (f === "S-11" || f === "S-11/A") return "Registration (REIT / similar)";
  if (f === "F-1" || f === "F-1/A") return "Foreign issuer registration";
  if (f === "F-3" || f === "F-3/A") return "Foreign issuer shelf registration";
  if (f === "F-4" || f === "F-4/A") return "Foreign issuer registration (business combo)";
  if (f === "4" || f === "4/A") return "Insider transaction (Form 4)";
  if (hasUsefulDesc && desc.toLowerCase() !== form.toLowerCase()) return desc.slice(0, 70) + (desc.length > 70 ? "…" : "");
  return form || "Filing";
}

function matchSearch(filing: Filing, query: string): boolean {
  let q = query.trim().toUpperCase();
  if (!q) return true;
  const form = normForm(filing.form);
  if (q === "10K" || q === "10-K" || q === "10-K/A") return form === "10-K" || form === "10-K/A";
  if (q === "10Q" || q === "10-Q" || q === "10-Q/A") return form === "10-Q" || form === "10-Q/A";
  if (q === "8K" || q === "8-K" || q === "8-K/A") return form === "8-K" || form === "8-K/A";
  if (q === "PROXY") return isProxy(filing.form);
  if (q === "PROSPECTUS") return isProspectus(filing.form);
  if (q.includes("10-K") || q === "10K") return form === "10-K" || form === "10-K/A";
  if (q.includes("10-Q") || q === "10Q") return form === "10-Q" || form === "10-Q/A";
  if (q.includes("8-K") || q === "8K") return form === "8-K" || form === "8-K/A";
  return form.includes(q) || (filing.description || "").toUpperCase().includes(q);
}

export function CompanyFilingsTab({ ticker }: { ticker: string }) {
  const [data, setData] = useState<SecFilingsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viaLookup, setViaLookup] = useState(false);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [lookupQuery, setLookupQuery] = useState("");
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupResults, setLookupResults] = useState<LookupHit[] | null>(null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);

  const [relatedRows, setRelatedRows] = useState<RelatedFilerRow[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(false);
  const [relatedError, setRelatedError] = useState<string | null>(null);
  const [relatedDisclaimer, setRelatedDisclaimer] = useState<string | null>(null);
  const [eftsIndexNote, setEftsIndexNote] = useState<string | null>(null);
  const [facetParentCik, setFacetParentCik] = useState<string | null>(null);

  const safeTicker = ticker?.trim() ?? "";

  const loadFilingsByCik = useCallback(async (cikPadded: string) => {
    setLoading(true);
    setError(null);
    setData(null);
    setViaLookup(true);
    setLookupResults(null);
    setLookupMsg(null);
    try {
      const res = await fetch(`/api/filings/by-cik/${encodeURIComponent(cikPadded)}`);
      const body = (await res.json()) as SecFilingsResult & { error?: string };
      if (!res.ok) {
        throw new Error(body.error ?? "Could not load filings for this CIK");
      }
      setData(body);
      setError(null);
      setQuickFilter("all");
      setSearchQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load filings");
      setData(null);
      setViaLookup(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const runCompanyOrCikSearch = useCallback(async () => {
    const raw = lookupQuery.trim();
    if (raw.length < 2) {
      setLookupMsg("Enter at least 2 characters, or a CIK (4–10 digits).");
      setLookupResults(null);
      return;
    }
    setLookupMsg(null);
    setLookupResults(null);

    if (looksLikeCikOnlyInput(raw)) {
      const digits = raw.replace(/\D/g, "");
      const cik = normalizeCikInput(digits);
      if (cik) {
        await loadFilingsByCik(cik);
        return;
      }
    }

    setLookupBusy(true);
    try {
      const res = await fetch(`/api/filings/search-companies?q=${encodeURIComponent(raw)}`);
      const body = (await res.json()) as { matches?: LookupHit[]; error?: string };
      if (!res.ok) {
        setLookupMsg(body.error ?? "Search failed");
        return;
      }
      const m = body.matches ?? [];
      if (m.length === 0) {
        setLookupMsg(
          "No matches in SEC’s company/ticker list. Try a shorter name, another spelling, or enter a numeric CIK (from EDGAR or old filings). Subsidiaries often file under the parent—search the parent name."
        );
      } else {
        setLookupResults(m);
      }
    } catch {
      setLookupMsg("Search failed. Try again.");
    } finally {
      setLookupBusy(false);
    }
  }, [lookupQuery, loadFilingsByCik]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setViaLookup(false);
    setQuickFilter("all");
    setSearchQuery("");
    setLookupResults(null);
    setLookupMsg(null);
    fetch(`/api/filings/${encodeURIComponent(safeTicker)}`)
      .then((res) => {
        if (!res.ok) {
          if (res.status === 404) return res.json().then((b) => { throw new Error(b.error ?? "Company not found"); });
          throw new Error("Failed to load filings");
        }
        return res.json();
      })
      .then((result: SecFilingsResult) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load filings");
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setRelatedLoading(true);
    setRelatedError(null);
    setRelatedDisclaimer(null);
    setRelatedRows([]);
    setEftsIndexNote(null);
    setFacetParentCik(null);
    fetch(`/api/filings/related-filers/${encodeURIComponent(safeTicker)}`)
      .then(async (res) => {
        const body = (await res.json()) as
          | {
              ok: true;
              parentCik?: string;
              related?: RelatedFilerRow[];
              disclaimer?: string;
              eftsTotalFilings?: number;
              eftsTruncated?: boolean;
            }
          | { ok: false; message?: string };
        if (cancelled) return;
        if (!res.ok || !body || typeof body !== "object" || !("ok" in body) || body.ok !== true) {
          const msg =
            body && typeof body === "object" && "message" in body && typeof body.message === "string"
              ? body.message
              : "Could not load related SEC registrants.";
          setRelatedError(msg);
          return;
        }
        setRelatedRows(Array.isArray(body.related) ? body.related : []);
        setRelatedDisclaimer(typeof body.disclaimer === "string" ? body.disclaimer : null);
        setFacetParentCik(typeof body.parentCik === "string" ? body.parentCik : null);
        const tot = typeof body.eftsTotalFilings === "number" ? body.eftsTotalFilings : null;
        const tr = body.eftsTruncated === true;
        if (tot != null) {
          setEftsIndexNote(
            tr
              ? `EFTS index: ~${tot.toLocaleString()} filings for this CIK (scan capped; counts may omit tail filings).`
              : `EFTS index: ${tot.toLocaleString()} filing(s) for this CIK.`
          );
        }
      })
      .catch(() => {
        if (!cancelled) setRelatedError("Could not load related SEC registrants.");
      })
      .finally(() => {
        if (!cancelled) setRelatedLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [safeTicker]);

  const filteredFilings = useMemo(() => {
    if (!data?.filings?.length) return [];
    const list = data.filings.filter((f) => {
      if (searchQuery.trim()) return matchSearch(f, searchQuery);
      return matchQuickFilter(f, quickFilter);
    });
    list.sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || "", "en"));
    return list;
  }, [data?.filings, quickFilter, searchQuery]);

  const lookupPanel = (
    <div
      className="mb-4 rounded-lg border p-3"
      style={{ borderColor: "var(--border2)", background: "var(--panel)" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
        Search by company name or CIK
      </p>
      <p className="text-[10px] leading-relaxed mb-3" style={{ color: "var(--muted2)" }}>
        Matches SEC’s public company/ticker file (~10k issuers). Subsidiaries often file only under a parent—try the parent name. For merged or delisted entities, use the{" "}
        <strong>10-digit CIK</strong> from an old cover page or{" "}
        <a
          href="https://www.sec.gov/edgar/searchedgar/legacy/companysearch.html"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "var(--blue)" }}
        >
          SEC company search
        </a>
        .
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          value={lookupQuery}
          onChange={(e) => setLookupQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runCompanyOrCikSearch();
          }}
          placeholder="Company name, or 4–10 digit CIK"
          className="min-w-[200px] flex-1 rounded border px-3 py-2 text-xs"
          style={{ borderColor: "var(--border2)", background: "var(--bg)", color: "var(--text)" }}
        />
        <button
          type="button"
          disabled={lookupBusy}
          onClick={() => void runCompanyOrCikSearch()}
          className="rounded border px-3 py-2 text-xs font-medium disabled:opacity-50"
          style={{ borderColor: "var(--border2)", color: "var(--accent)" }}
        >
          {lookupBusy ? "Searching…" : "Search"}
        </button>
      </div>
      {lookupMsg ? (
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {lookupMsg}
        </p>
      ) : null}
      {lookupResults && lookupResults.length > 0 ? (
        <ul
          className="mt-3 max-h-52 overflow-y-auto space-y-1 rounded border p-2"
          style={{ borderColor: "var(--border2)" }}
        >
          {lookupResults.map((h) => (
            <li key={h.cik}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-white/[0.05]"
                onClick={() => void loadFilingsByCik(h.cik)}
              >
                <span className="font-medium" style={{ color: "var(--text)" }}>
                  {h.title}
                </span>
                <span className="mt-0.5 block font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                  CIK {h.cik}
                  {h.ticker && h.ticker !== "—" ? ` · ${h.ticker}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );

  const relatedSubsidiariesPanel = (
    <div
      className="mb-4 rounded-lg border p-3"
      style={{ borderColor: "var(--border2)", background: "var(--panel)" }}
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
        Entity
      </p>
      <p className="text-[10px] leading-relaxed mb-2" style={{ color: "var(--muted2)" }}>
        Same idea as SEC EDGAR Search (full-text index / EFTS) for sidebar ticker{" "}
        <span className="font-mono">{safeTicker}</span>
        {facetParentCik || data?.cik ? (
          <>
            {" "}
            —{" "}
            <a
              href={`https://www.sec.gov/edgar/search/#/ciks=${(facetParentCik ?? data?.cik ?? "")
                .replace(/\D/g, "")
                .padStart(10, "0")}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--blue)" }}
            >
              open on SEC.gov
            </a>
          </>
        ) : null}
        . Rows and hit counts mirror that site’s Entity facet (subsidiaries, insiders, funds). Click a row to load that
        CIK’s filings; sidebar
        ticker is unchanged for save actions.
        {eftsIndexNote ? (
          <>
            {" "}
            <span style={{ color: "var(--muted)" }}>{eftsIndexNote}</span>
          </>
        ) : null}
      </p>
      {relatedLoading && relatedRows.length === 0 && !relatedError ? (
        <div className="flex items-center gap-2 py-2 text-[11px]" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Loading EDGAR search entities…
        </div>
      ) : null}
      {relatedError ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {relatedError}
        </p>
      ) : null}
      {!relatedLoading && !relatedError && relatedRows.length === 0 ? (
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          No entities returned from the EDGAR full-text index for this CIK.
        </p>
      ) : null}
      {relatedRows.length > 0 ? (
        <ul className="mt-2 max-h-80 overflow-y-auto rounded border" style={{ borderColor: "var(--border2)" }}>
          {relatedRows.map((r) => (
            <li
              key={`${r.cik}::${r.entityName}`}
              className="border-b last:border-b-0"
              style={{ borderColor: "var(--border2)" }}
            >
              <button
                type="button"
                title={`${r.filingCount.toLocaleString()} indexed hit(s) with this entity label alongside CIK ${facetParentCik ?? data?.cik ?? ""}. Open ${r.cik}’s filings.`}
                className="flex w-full items-start gap-2 px-2 py-2 text-left text-xs transition-colors hover:bg-white/[0.05]"
                onClick={() => void loadFilingsByCik(r.cik)}
              >
                <span
                  className="shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold tabular-nums"
                  style={{ background: "var(--border2)", color: "var(--text)" }}
                >
                  {r.filingCount}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium" style={{ color: "var(--blue)" }}>
                    {r.entityName}
                  </span>
                  <span className="mt-0.5 block font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                    {r.ticker && r.ticker !== "—" ? `(${r.ticker}) ` : ""}CIK {r.cik}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {relatedDisclaimer ? (
        <p className="mt-2 text-[10px] leading-relaxed" style={{ color: "var(--muted2)" }}>
          {relatedDisclaimer}
        </p>
      ) : null}
    </div>
  );

  if (!safeTicker) {
    return (
      <Card title="SEC Filings">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>Select a company to view filings.</p>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card title="SEC Filings">
        {lookupPanel}
        {relatedSubsidiariesPanel}
        <div className="flex items-center gap-2 py-6" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Loading filings…
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="SEC Filings">
        {lookupPanel}
        {relatedSubsidiariesPanel}
        <div className="rounded-lg border py-4" style={{ borderColor: "var(--danger)", background: "rgba(239,68,68,0.06)" }}>
          <p className="px-4 text-sm" style={{ color: "var(--danger)" }}>{error}</p>
          <p className="mt-1 px-4 text-[11px]" style={{ color: "var(--muted)" }}>
            Ticker not in SEC’s ticker list, or no data. Use the search above by name or CIK.
          </p>
        </div>
      </Card>
    );
  }

  if (!data || data.filings.length === 0) {
    return (
      <Card title={data ? `SEC Filings — ${data.companyName}` : "SEC Filings"}>
        {lookupPanel}
        {relatedSubsidiariesPanel}
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          No recent filings in EDGAR for this entity
          {viaLookup ? "" : ` (${safeTicker})`}.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`SEC Filings — ${data.companyName}`}>
      {lookupPanel}
      {relatedSubsidiariesPanel}
      {viaLookup ? (
        <p className="text-[10px] leading-relaxed mb-3" style={{ color: "var(--muted)" }}>
          Filings for <span className="font-mono">{data.cik}</span> (name search / CIK). Sidebar ticker{" "}
          <span className="font-mono">{safeTicker}</span> unchanged — save actions still use it.
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-1 rounded border overflow-hidden" style={{ borderColor: "var(--border2)" }}>
          {(
            [
              { value: "all" as QuickFilter, label: "All" },
              { value: "10k10q" as QuickFilter, label: "10-K / 10-Q" },
              { value: "8k" as QuickFilter, label: "8-K" },
              { value: "proxy" as QuickFilter, label: "Proxy" },
              { value: "prospectus" as QuickFilter, label: "Prospectus" },
            ] as const
          ).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => setQuickFilter(value)}
              className="px-3 py-1.5 text-xs font-medium transition-colors"
              style={{
                background: quickFilter === value && !searchQuery.trim() ? "var(--accent)" : "transparent",
                color: quickFilter === value && !searchQuery.trim() ? "var(--bg)" : "var(--muted2)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <input
          type="text"
          placeholder="Filter by form (e.g. 10-K, 8-K, proxy, prospectus)"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="min-w-[200px] max-w-[280px] rounded border px-3 py-1.5 text-xs font-mono placeholder:font-sans"
          style={{ borderColor: "var(--border2)", background: "var(--bg)", color: "var(--text)" }}
        />
      </div>
      {filteredFilings.length === 0 ? (
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          No filings match the current filter.
        </p>
      ) : (
        <DataTable>
          <thead>
            <tr>
              <th>Filing Type</th>
              <th>Filing Date</th>
              <th>Summary</th>
              <th>Document</th>
            </tr>
          </thead>
          <tbody>
            {filteredFilings.map((f) => (
              <tr key={f.filingDate + f.docUrl}>
                <td className="font-mono">{f.form}</td>
                <td className="font-mono text-[11px]">{f.filingDate}</td>
                <td className="max-w-[320px] truncate text-xs" style={{ color: "var(--muted2)" }} title={getFilingSummary(f.form, f.filingDate, f.description)}>
                  {getFilingSummary(f.form, f.filingDate, f.description)}
                </td>
                <td className="text-xs">
                  <span className="inline-flex flex-wrap items-center gap-y-0.5">
                    <a
                      href={f.docUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium"
                      style={{ color: "var(--blue)" }}
                    >
                      View
                    </a>
                    <SaveFilingLinkButton ticker={safeTicker} url={f.docUrl} />
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </Card>
  );
}
