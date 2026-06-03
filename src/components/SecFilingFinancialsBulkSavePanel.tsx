"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui";
import {
  saveFilingStatementsXlsxToServer,
  type SecFilingFinancialsApiResponse,
} from "@/lib/sec-filing-financials-save-client";
import { normalizeAccessionKey, type PresentedFiling } from "@/lib/sec-xbrl-as-presented-save-client";

/**
 * Bulk-save SEC primary HTML statement workbooks (same source as the SEC Filing Financials tab)
 * for use with the deterministic financial compiler on Historical Financial Statements.
 */
export function SecFilingFinancialsBulkSavePanel({
  ticker,
  onAfterBulkSave,
}: {
  ticker: string;
  onAfterBulkSave?: () => void;
}) {
  const tk = (ticker ?? "").trim().toUpperCase();
  const { status: authStatus } = useSession();
  const tabAliveRef = useRef(true);
  const [listData, setListData] = useState<SecFilingFinancialsApiResponse | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [listErr, setListErr] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; label: string } | null>(null);
  const [bulkMsg, setBulkMsg] = useState<string | null>(null);

  useEffect(() => {
    tabAliveRef.current = true;
    return () => {
      tabAliveRef.current = false;
    };
  }, [tk]);

  useEffect(() => {
    if (!tk) return;
    let cancelled = false;
    setListLoading(true);
    setListErr(null);
    void (async () => {
      try {
        const res = await fetch(`/api/sec/filing-financials/${encodeURIComponent(tk)}`, { cache: "no-store" });
        const j = (await res.json()) as SecFilingFinancialsApiResponse;
        if (!res.ok || j.ok === false) throw new Error(j.error || "Failed to load SEC filing financials");
        if (!cancelled) setListData(j);
      } catch (e) {
        if (!cancelled) setListErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setListLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tk]);

  const runBulkSave = useCallback(() => {
    if (authStatus !== "authenticated" || bulkSaving || !tk) return;
    const filings: PresentedFiling[] = listData?.filings ?? [];
    if (filings.length === 0) return;
    setBulkMsg(null);
    setBulkSaving(true);
    setBulkProgress({ done: 0, total: filings.length, label: "" });
    void (async () => {
      let saved = 0;
      let skipped = 0;
      let failed = 0;
      const failNotes: string[] = [];
      const companyName = listData?.companyName;
      const cik = listData?.cik;

      try {
        for (let i = 0; i < filings.length; i++) {
          if (!tabAliveRef.current) break;
          const f = filings[i]!;
          setBulkProgress({
            done: i,
            total: filings.length,
            label: `${f.filingDate} ${f.form}`,
          });
          try {
            const res = await fetch(
              `/api/sec/filing-financials/${encodeURIComponent(tk)}?acc=${encodeURIComponent(f.accessionNumber)}`,
              { cache: "no-store" },
            );
            const j = (await res.json()) as SecFilingFinancialsApiResponse;
            const stmts = j.statements ?? [];
            if (!res.ok || j.ok === false) {
              failed++;
              failNotes.push(`${f.accessionNumber}: ${j.error ?? res.statusText}`);
              continue;
            }
            if (!stmts.length) {
              skipped++;
              continue;
            }
            const r = await saveFilingStatementsXlsxToServer(
              tk,
              {
                form: f.form,
                filingDate: f.filingDate,
                accessionNumber: f.accessionNumber,
              },
              companyName ?? j.companyName,
              cik ?? j.cik,
              stmts,
            );
            if (r.ok) saved++;
            else {
              failed++;
              failNotes.push(`${f.accessionNumber}: ${r.error}`);
            }
          } catch (e) {
            failed++;
            failNotes.push(`${f.accessionNumber}: ${e instanceof Error ? e.message : "error"}`);
          }
        }

        if (tabAliveRef.current) {
          const tail = failNotes.length
            ? ` Errors (first 5): ${failNotes.slice(0, 5).join(" · ")}${failNotes.length > 5 ? "…" : ""}`
            : "";
          setBulkMsg(
            `Saved ${saved} workbook(s). Skipped ${skipped} (no parsed statements). Failed ${failed}.${tail}`,
          );
        }
      } finally {
        setBulkSaving(false);
        setBulkProgress(null);
        onAfterBulkSave?.();
      }
    })();
  }, [authStatus, bulkSaving, listData, onAfterBulkSave, tk]);

  const filings: PresentedFiling[] = listData?.filings ?? [];
  const selectedAcc = listData?.selected?.accessionNumber ?? "";

  if (!tk) {
    return (
      <p className="text-sm" style={{ color: "var(--muted2)" }}>
        Select a company with a ticker.
      </p>
    );
  }

  return (
    <Card>
      {listLoading ? (
        <p className="text-sm" style={{ color: "var(--muted2)" }}>
          Loading filings…
        </p>
      ) : listErr ? (
        <p className="text-sm" style={{ color: "var(--warn)" }}>
          {listErr}
        </p>
      ) : null}

      {!listLoading && !listErr && filings.length > 0 ? (
        <div className="pt-0.5">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color: "var(--muted)" }}>
                All filings (10-K / 10-Q) — HTML statement tables
              </p>
              <p className="mt-0.5 text-[11px]" style={{ color: "var(--muted2)" }}>
                {filings.length} filing{filings.length === 1 ? "" : "s"} in the last ~20 years. Each saved workbook uses the
                same layout as the SEC Filing Financials tab (Meta + Income Statement, Balance Sheet, Cash Flow from the
                filing HTML).
              </p>
            </div>
            <button
              type="button"
              className="rounded-md border px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
              style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              disabled={bulkSaving || authStatus !== "authenticated" || listLoading || Boolean(listErr)}
              title={
                authStatus !== "authenticated"
                  ? "Sign in to save workbooks to Saved Documents."
                  : "Fetch each filing and save one .xlsx per accession. Re-running replaces the same file for each filing."
              }
              onClick={runBulkSave}
            >
              {bulkSaving ? "Saving…" : "Bulk save SEC filing financials"}
            </button>
          </div>
          {bulkProgress && bulkSaving ? (
            <p className="mt-2 text-[10px] font-mono" style={{ color: "var(--muted2)" }}>
              {bulkProgress.done + 1}/{bulkProgress.total} · {bulkProgress.label}
            </p>
          ) : null}
          {bulkMsg ? (
            <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--muted2)" }}>
              {bulkMsg}
            </p>
          ) : null}
          <div
            className="mt-2 max-h-56 overflow-y-auto rounded border text-xs"
            style={{ borderColor: "var(--border2)", background: "var(--card2)" }}
          >
            <ul className="divide-y p-0" style={{ borderColor: "var(--border2)" }}>
              {filings.map((f) => {
                const isSel = normalizeAccessionKey(f.accessionNumber) === normalizeAccessionKey(selectedAcc);
                return (
                  <li
                    key={f.accessionNumber}
                    className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-2 py-1.5"
                    style={{
                      background: isSel ? "var(--panel)" : undefined,
                      borderColor: "var(--border2)",
                    }}
                  >
                    <span className="shrink-0 font-mono text-[10px]" style={{ color: "var(--muted)" }}>
                      {f.filingDate}
                    </span>
                    <span className="shrink-0 font-semibold" style={{ color: "var(--text)" }}>
                      {f.form}
                    </span>
                    <span className="min-w-0 break-all font-mono text-[10px]" style={{ color: "var(--muted2)" }}>
                      {f.accessionNumber}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      ) : !listLoading && !listErr ? (
        <p className="mt-3 text-sm" style={{ color: "var(--muted2)" }}>
          No filings returned for this ticker.
        </p>
      ) : null}
    </Card>
  );
}
