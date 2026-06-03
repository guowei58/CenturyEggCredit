/**
 * Display helpers for HTML-face statements.
 * Monetary lines: values from the HTML parser are stored in **$ millions** (`valueFormat: usd_millions`).
 * EPS and share-count lines stay at **native** scale (`valueFormat: native`).
 */

import { isSecXbrlPerShareRowConcept, isSecXbrlShareCountRowConcept } from "@/lib/sec-xbrl-as-presented-scale";
import type { FacePresentedStatementRow } from "@/lib/sec-ixbrl-face-extract";

const FACE_TWO_DECIMALS: Intl.NumberFormatOptions = {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
};

function labelLower(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.:]+$/g, "").trim();
}

/** Weighted-average share rows reuse "Basic" / "Diluted" labels; EPS amounts are small per-share dollars. */
function valuesLookLikeShareCounts(row: Pick<FacePresentedStatementRow, "values">): boolean {
  const vals = Object.values(row.values).filter((v): v is number => v !== null && Number.isFinite(v));
  if (vals.length === 0) return false;
  return vals.some((v) => Math.abs(v) >= 100);
}

/** Parse visible cell text for EPS (no unit scaling). */
function parseFaceDisplayedNumber(text: string): number | null {
  const raw = text.replace(/\s+/g, " ").trim();
  if (!raw || raw === "—" || raw === "-") return null;
  let normalized = raw.replace(/\$/g, "").replace(/,/g, "").replace(/\s+/g, "");
  const negative = /^\(.*\)$/.test(normalized);
  normalized = normalized.replace(/[()]/g, "");
  if (!/^-?\d*\.?\d+$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

/** EPS / per-share income lines — native dollars per share, not $ millions. */
export function isFaceEpsRow(row: FacePresentedStatementRow): boolean {
  if (isSecXbrlPerShareRowConcept(row.concept)) return true;
  const lab = labelLower(row.label);
  if (/^(?:basic|diluted)$/.test(lab)) return !valuesLookLikeShareCounts(row);
  if (/\bearnings\s+per\s+(?:common\s+)?share\b/.test(lab)) return true;
  if (/\b(?:basic|diluted)\s+(?:and\s+)?(?:diluted\s+)?(?:earnings|income|loss)\s+per\s+(?:common\s+)?share\b/.test(lab)) {
    return true;
  }
  if (/\bshares?\b/.test(lab) || /\bweighted\s+average\b/.test(lab)) return false;
  if (!/\bper\s+share\b/.test(lab)) return false;
  return (
    /\b(?:earnings|income|loss|eps)\b/.test(lab) ||
    /\b(?:basic|diluted)\b/.test(lab) ||
    /\bnet\s+(?:income|loss|earnings)\b/.test(lab)
  );
}

/** EPS uses the face-printed amount — never thousands/millions unit factors. */
export function faceEpsValue(row: FacePresentedStatementRow, periodKey: string): number | null {
  const visible = row.visibleTextByPeriod?.[periodKey]?.trim();
  if (visible) {
    const fromVisible = parseFaceDisplayedNumber(visible);
    if (fromVisible !== null) return fromVisible;
  }
  const v = row.values[periodKey];
  if (v === null || !Number.isFinite(v)) return null;
  return v;
}

export type FaceStatementId = "income-statement" | "balance-sheet" | "cash-flow";

/** Share-count lines only appear on the income statement (EPS note / weighted-average shares). */
export function isFaceShareCountRow(row: FacePresentedStatementRow, statementId?: FaceStatementId): boolean {
  if (statementId != null && statementId !== "income-statement") return false;
  if (isSecXbrlShareCountRowConcept(row.concept)) return true;
  const lab = labelLower(row.label);
  if (/^(?:basic|diluted)$/.test(lab) && valuesLookLikeShareCounts(row)) return true;
  if (/\bper\s+share\b/.test(lab)) return false;
  if (/\bshares?\b/.test(lab) || /\bweighted\s+average\b/.test(lab)) return true;
  if (isFaceEpsRow(row)) return false;
  return false;
}

/** Monetary grid cell: already in $ millions. */
export function formatFaceMonetaryMillions(v: number): string {
  const sign = v < 0 ? "-" : "";
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, FACE_TWO_DECIMALS);
  return `${sign}$${s}M`;
}

/** EPS: native dollars per share. */
export function formatFaceEpsNative(v: number): string {
  const sign = v < 0 ? "−" : "";
  const abs = Math.abs(v);
  const s = abs.toLocaleString(undefined, FACE_TWO_DECIMALS);
  return `${sign}$${s}`;
}

/**
 * Share counts from HTML may be full shares, thousands, or (rarely) already millions.
 * Normalize to millions of shares for display.
 */
function shareCountToDisplayMillions(v: number): number {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return v / 1_000_000;
  if (abs >= 1_000) return v / 1_000;
  return v;
}

/**
 * Numeric cell at display scale — single source for the TEST grid and workbook export.
 * Monetary: $ millions. EPS: native $/share. Share counts: millions of shares.
 */
export function faceStatementCellNumeric(
  row: FacePresentedStatementRow,
  periodKey: string,
  statementId?: FaceStatementId
): number | null {
  const v = row.values[periodKey];
  if (v === null || !Number.isFinite(v)) return null;
  if (isFaceShareCountRow(row, statementId)) return shareCountToDisplayMillions(v);
  if (isFaceEpsRow(row)) return faceEpsValue(row, periodKey);
  return v;
}

export function formatFaceShareCountMillions(v: number): string {
  const millions = shareCountToDisplayMillions(v);
  const sign = millions < 0 ? "-" : "";
  const absM = Math.abs(millions);
  const s = absM.toLocaleString(undefined, FACE_TWO_DECIMALS);
  return `${sign}${s}M`;
}

export function formatFaceStatementCell(
  row: FacePresentedStatementRow,
  periodKey: string,
  statementId?: FaceStatementId
): string {
  const n = faceStatementCellNumeric(row, periodKey, statementId);
  if (n === null) return "—";

  if (isFaceShareCountRow(row, statementId)) {
    const sign = n < 0 ? "-" : "";
    const s = Math.abs(n).toLocaleString(undefined, FACE_TWO_DECIMALS);
    return `${sign}${s}M`;
  }
  if (isFaceEpsRow(row)) return formatFaceEpsNative(n);
  return formatFaceMonetaryMillions(n);
}

/** Scale monetary face values to full USD for workbook export (Excel builder divides by 1e6). */
export function faceValuesToFullUsd(
  row: Pick<FacePresentedStatementRow, "concept" | "label" | "valueFormat" | "values">,
  statementId?: FaceStatementId
): Record<string, number | null> {
  const faceRow = row as FacePresentedStatementRow;
  if (isFaceEpsRow(faceRow) || isFaceShareCountRow(faceRow, statementId)) {
    return { ...row.values };
  }
  if (row.valueFormat === "native") return { ...row.values };
  return Object.fromEntries(
    Object.entries(row.values).map(([k, v]) => [k, v !== null && Number.isFinite(v) ? v * 1_000_000 : v])
  );
}
