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

export type FaceStatementRowEmphasis = "heading" | "subtotal" | "normal";

function normalizedFaceLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.:]+$/g, "").trim();
}

/** Match compiler / historical workbook emphasis for key subtotals and section headers. */
export function faceStatementRowEmphasis(
  row: Pick<FacePresentedStatementRow, "label" | "rowKind">,
  statementId: FaceStatementId
): FaceStatementRowEmphasis {
  if (row.rowKind === "heading") return "heading";
  if (row.rowKind === "total") return "subtotal";

  const ll = normalizedFaceLabel(row.label);
  if (!ll) return "normal";

  if (statementId === "income-statement") {
    if (
      /^total\b/.test(ll) ||
      /\bgross profit\b/.test(ll) ||
      /\boperating income\b/.test(ll) ||
      /\bloss from operations\b/.test(ll) ||
      /\bincome from operations\b/.test(ll) ||
      /\bnet income\b/.test(ll) ||
      /\bnet loss\b/.test(ll) ||
      /\bnet earnings\b/.test(ll) ||
      /\bnet revenues\b/.test(ll) ||
      /^revenues?$/.test(ll) ||
      /\btotal revenues\b/.test(ll) ||
      /\btotal net sales\b/.test(ll) ||
      /^net sales$/.test(ll) ||
      /\bcomprehensive income\b/.test(ll) ||
      /\bincome(?:\s*\(loss\))?\s+before income taxes\b/.test(ll) ||
      /\bloss(?:\s*\(loss\))?\s+before income taxes\b/.test(ll) ||
      /\bincome before income taxes\b/.test(ll) ||
      /\bpretax income\b/.test(ll)
    ) {
      return "subtotal";
    }
    return "normal";
  }

  if (statementId === "balance-sheet") {
    if (
      /^(total\s+)?assets$/.test(ll) ||
      /^assets$/.test(ll) ||
      /^(total\s+)?liabilities$/.test(ll) ||
      /^liabilities$/.test(ll) ||
      /\btotal current assets\b/.test(ll) ||
      /^current assets$/.test(ll) ||
      /\btotal current liabilities\b/.test(ll) ||
      /^current liabilities$/.test(ll) ||
      /\btotal stockholders'? equity\b/.test(ll) ||
      /\btotal shareholders'? equity\b/.test(ll) ||
      /^total equity$/.test(ll) ||
      /\btotal liabilities and stockholders'? equity\b/.test(ll) ||
      /\btotal liabilities and shareholders'? equity\b/.test(ll) ||
      /\bliabilities and equity\b/.test(ll)
    ) {
      return "subtotal";
    }
    return "normal";
  }

  if (
    /\bcash\s+(?:flows?\s+)?from\s+operat/i.test(ll) ||
    /\bcash\s+provided\s+by\s+operating/i.test(ll) ||
    /\bcash\s+(?:flows?\s+)?from\s+invest/i.test(ll) ||
    /\bcash\s+provided\s+by\s+investing/i.test(ll) ||
    /\bcash\s+(?:flows?\s+)?from\s+financ/i.test(ll) ||
    /\bcash\s+provided\s+by\s+financing/i.test(ll) ||
    /\bnet increase\b.*\bcash\b/.test(ll) ||
    /\bnet decrease\b.*\bcash\b/.test(ll) ||
    /\bcash at end of\b/.test(ll) ||
    /^net cash\b/.test(ll)
  ) {
    return "subtotal";
  }

  return "normal";
}

const COMPILER_STMT_TO_FACE_ID: Record<string, FaceStatementId> = {
  income_statement: "income-statement",
  balance_sheet: "balance-sheet",
  cash_flow: "cash-flow",
};

/** Row emphasis for compiled historical statements (same rules as Period Financials HTML-face grids). */
export function compilerStatementRowEmphasis(
  lineLabel: string,
  compilerStatementKey: string
): FaceStatementRowEmphasis {
  const faceId = COMPILER_STMT_TO_FACE_ID[compilerStatementKey];
  if (!faceId) return "normal";
  return faceStatementRowEmphasis({ label: lineLabel, rowKind: "data" }, faceId);
}

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
