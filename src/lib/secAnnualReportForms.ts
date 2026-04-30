/**
 * Pure helpers for classifying SEC annual report forms and picking the latest filing.
 * Kept separate from `sec-10k.ts` because that module uses `"use server"` and must not export non-async functions.
 */

import type { SecFiling } from "@/lib/sec-edgar";

/**
 * Annual report forms in the 10-K family (SEC EDGAR).
 * Excludes "NT 10-K" (late filing notices) — those are not substantive annual reports.
 */
function isAnnualTenKForm(formRaw: string): boolean {
  const raw = (formRaw ?? "").trim().replace(/\u00a0/g, " ");
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (/\bNT\s*10-K\b/i.test(compact)) return false;
  const u = compact.toUpperCase();
  if (u === "10-K" || u === "10-K/A") return true;
  if (u === "10-KT" || u === "10-KT/A") return true;
  if (/^10-K\d/i.test(u.replace(/\s/g, ""))) return true;
  return false;
}

/** Foreign private issuers often file 20-F instead of 10-K (still includes Exhibit 21–style schedules). */
function isAnnual20FForm(formRaw: string): boolean {
  const raw = (formRaw ?? "").trim().replace(/\u00a0/g, " ");
  if (!raw) return false;
  const compact = raw.replace(/\s+/g, " ").trim();
  if (/\bNT\s*20-F\b/i.test(compact)) return false;
  const u = compact.toUpperCase();
  return u === "20-F" || u === "20-F/A";
}

/** US domestic 10-K family or foreign 20-F annual reports (for “latest annual” resolution). */
export function isQualifyingAnnualReportForm(formRaw: string): boolean {
  return isAnnualTenKForm(formRaw) || isAnnual20FForm(formRaw);
}

function normalizeSecForm(formRaw: string): string {
  return (formRaw ?? "").trim().replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim().toUpperCase().replace(/\s+/g, "");
}

/**
 * Substantive Form 10-K only — not 10-K/A, 10-KT, 10-KT/A, or other variants.
 * Amendments are excluded so “latest” tracks the original annual report filing date.
 */
export function isPlainForm10K(formRaw: string): boolean {
  const raw = (formRaw ?? "").trim().replace(/\u00a0/g, " ");
  if (!raw || /\bNT\s*10-K\b/i.test(raw.replace(/\s+/g, " "))) return false;
  return normalizeSecForm(formRaw) === "10-K";
}

/**
 * Substantive Form 20-F only — not 20-F/A (foreign private issuer annual).
 */
export function isPlainForm20F(formRaw: string): boolean {
  const raw = (formRaw ?? "").trim().replace(/\u00a0/g, " ");
  if (!raw || /\bNT\s*20-F\b/i.test(raw.replace(/\s+/g, " "))) return false;
  return normalizeSecForm(formRaw) === "20-F";
}

export function pickLatestAnnualReport(filings: SecFiling[]): SecFiling | null {
  const tenKs = filings
    .filter((f) => typeof f.form === "string" && isPlainForm10K(f.form))
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
  if (tenKs.length > 0) return tenKs[0]!;

  const f20 = filings
    .filter((f) => typeof f.form === "string" && isPlainForm20F(f.form))
    .sort((a, b) => (b.filingDate || "").localeCompare(a.filingDate || ""));
  if (f20.length > 0) return f20[0]!;

  return null;
}
