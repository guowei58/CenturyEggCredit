"use client";

import { useEffect, useMemo, useState } from "react";
import { SaveFilingLinkButton } from "@/components/SaveFilingLinkButton";
import { Card, DataTable } from "@/components/ui";

type Filing = { form: string; filingDate: string; description: string; docUrl: string };

type SecFilingsResult = {
  companyName: string;
  cik: string;
  filings: Filing[];
};

type QuickFilter = "all" | "10k10q" | "8k" | "proxy" | "prospectus";

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
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const safeTicker = ticker?.trim() ?? "";

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    setQuickFilter("all");
    setSearchQuery("");
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
    return () => { cancelled = true; };
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
        <div className="flex items-center gap-2 py-8" style={{ color: "var(--muted)" }}>
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--border2)] border-t-[var(--accent)]" />
          Loading filings for {safeTicker}…
        </div>
      </Card>
    );
  }

  if (error) {
    return (
      <Card title="SEC Filings">
        <div className="rounded-lg border py-4" style={{ borderColor: "var(--danger)", background: "rgba(239,68,68,0.06)" }}>
          <p className="px-4 text-sm" style={{ color: "var(--danger)" }}>{error}</p>
          <p className="mt-1 px-4 text-[11px]" style={{ color: "var(--muted)" }}>Check the ticker symbol or try again. Data from SEC EDGAR.</p>
        </div>
      </Card>
    );
  }

  if (!data || data.filings.length === 0) {
    return (
      <Card title="SEC Filings">
        <p className="text-sm" style={{ color: "var(--muted2)" }}>No recent filings found for {safeTicker}.</p>
      </Card>
    );
  }

  return (
    <Card title={`SEC Filings — ${data.companyName}`}>
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
