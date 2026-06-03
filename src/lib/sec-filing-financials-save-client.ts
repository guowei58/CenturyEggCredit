import { buildFilingHtmlStatementsWorkbook, downloadFilingHtmlStatementsExcel, workbookToFilingHtmlXlsxUint8Array } from "@/lib/sec-filing-financials-excel";
import type { FilingHtmlStatement } from "@/lib/sec-filing-financials";
import type { PresentedFiling } from "@/lib/sec-xbrl-as-presented-save-client";

export type SecFilingFinancialsApiResponse = {
  ok?: boolean;
  error?: string;
  ticker?: string;
  cik?: string;
  companyName?: string;
  filings?: PresentedFiling[];
  selected?: { form: string; filingDate: string; accessionNumber: string };
  statements?: FilingHtmlStatement[];
};

function buildWorkbookParams(
  tk: string,
  companyName: string | undefined,
  cik: string | undefined,
  filing: { form: string; filingDate: string; accessionNumber: string },
  statements: FilingHtmlStatement[]
) {
  return {
    ticker: tk,
    companyName,
    cik,
    filing,
    statements: statements.map((stmt) => ({
      title: stmt.title,
      role: stmt.role,
      units: stmt.units,
      periods: stmt.periods,
      rows: stmt.rows,
    })),
  };
}

export function downloadFilingStatementsXlsx(
  tk: string,
  companyName: string | undefined,
  cik: string | undefined,
  filing: { form: string; filingDate: string; accessionNumber: string },
  statements: FilingHtmlStatement[]
): void {
  downloadFilingHtmlStatementsExcel(buildWorkbookParams(tk, companyName, cik, filing, statements));
}

export async function saveFilingStatementsXlsxToServer(
  tk: string,
  filing: { form: string; filingDate: string; accessionNumber: string },
  companyName: string | undefined,
  cik: string | undefined,
  statements: FilingHtmlStatement[]
): Promise<{ ok: true; filename?: string } | { ok: false; error: string }> {
  if (!statements.length) return { ok: false, error: "No statements to export" };
  try {
    const params = buildWorkbookParams(tk, companyName, cik, filing, statements);
    const wb = buildFilingHtmlStatementsWorkbook(params);
    const u8 = workbookToFilingHtmlXlsxUint8Array(wb);
    const blob = new Blob([new Uint8Array(u8)], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const fd = new FormData();
    fd.append("action", "save-sec-filing-financials-xlsx");
    fd.append("file", blob, "SEC-filing-financials.xlsx");
    fd.append("filingForm", filing.form);
    fd.append("filingDate", filing.filingDate);
    fd.append("accessionNumber", filing.accessionNumber);

    const res = await fetch(`/api/saved-documents/${encodeURIComponent(tk)}`, {
      method: "POST",
      body: fd,
    });
    const j = (await res.json().catch(() => null)) as {
      ok?: boolean;
      error?: string;
      item?: { filename?: string };
    } | null;
    if (!res.ok || j?.ok !== true) {
      return { ok: false, error: j?.error ?? `Save failed (HTTP ${res.status})` };
    }
    return { ok: true, filename: j.item?.filename };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}
