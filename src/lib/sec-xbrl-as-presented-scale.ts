/**
 * Scale for SEC XBRL **as-presented** grids and workbooks.
 *
 * Most monetary line items are stored from the instance in **USD** (full dollars)
 * and shown as **$ millions** in the UI / Excel. **Per-share** facts (EPS, etc.)
 * are already **dollars per share** in XBRL and must not be divided by 1e6.
 * **Share-count** facts (weighted average shares, shares outstanding) use **millions of shares**
 * in the UI **without** a `$` prefix.
 */

function conceptLocalName(concept: string): string {
  const raw = concept.trim();
  if (!raw) return "";
  const i = Math.max(raw.lastIndexOf(":"), raw.lastIndexOf("/"));
  return (i >= 0 ? raw.slice(i + 1) : raw).replace(/_/g, "").toLowerCase();
}

/**
 * True when the row should be shown at **native** instance scale (per-share),
 * not ÷ 1,000,000.
 */
export function isSecXbrlPerShareRowConcept(concept: string): boolean {
  const u = conceptLocalName(concept);
  if (!u) return false;
  if (u.includes("earningspershare")) return true;
  if (u.includes("perbasicshare")) return true;
  if (u.includes("perdilutedshare")) return true;
  if (u.includes("pershare") && u.includes("dividend")) return true;
  if (u.includes("pershare") && u.includes("netincome")) return true;
  if (u.includes("pershare") && u.includes("incomelossfromcontinuing")) return true;
  if (u.includes("pershare") && u.includes("discontinuedoperation")) return true;
  return false;
}

/**
 * True when the row is a **share count** (xbrli:shares-style facts: weighted average shares, shares outstanding, etc.),
 * not currency. Shown in the grid as **millions of shares** without a `$` prefix (unlike monetary lines).
 */
export function isSecXbrlShareCountRowConcept(concept: string): boolean {
  if (isSecXbrlPerShareRowConcept(concept)) return false;
  const u = conceptLocalName(concept);
  if (!u) return false;
  if (u.includes("weightedaverage") && u.includes("share")) return true;
  if (u.includes("entitycommonstocksharesoutstanding")) return true;
  if (u.includes("commonstocksharesoutstanding") && !u.includes("par") && !u.includes("value")) return true;
  if (u.includes("numberofshares") && (u.includes("outstanding") || u.includes("authorized") || u.includes("issued")))
    return true;
  if (u.includes("incrementalcommonshares")) return true;
  if (u.includes("treasurystock") && u.includes("share")) return true;
  if (u.includes("denominator") && u.includes("share") && u.includes("weighted")) return true;
  return false;
}

function labelLower(label: string): string {
  return label.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.:]+$/g, "").trim();
}

/** EPS rows in workbooks — native $/share, never ÷ 1e6. */
export function isWorkbookEpsRow(concept: string, label: string): boolean {
  if (isSecXbrlPerShareRowConcept(concept)) return true;
  const lab = labelLower(label);
  if (/^(?:basic|diluted)$/.test(lab)) return true;
  if (/\bearnings\s+per\s+(?:common\s+)?share\b/.test(lab)) return true;
  if (/\b(?:basic|diluted)\s+(?:and\s+)?(?:diluted\s+)?(?:earnings|income|loss)\s+per\s+(?:common\s+)?share\b/.test(lab)) {
    return true;
  }
  if (/\bshares?\b/.test(lab) || /\bweighted\s+average\b/.test(lab)) return false;
  if (!/\bper\s+share\b/.test(lab)) return false;
  return /\b(?:earnings|income|loss|eps)\b/.test(lab) || /\b(?:basic|diluted)\b/.test(lab);
}

/** Share-count rows → millions of shares in workbooks (income statement only — matches face grid). */
export function isWorkbookShareCountRow(
  concept: string,
  label: string,
  statementKind?: "is" | "bs" | "cf"
): boolean {
  if (statementKind != null && statementKind !== "is") return false;
  if (isWorkbookEpsRow(concept, label)) return false;
  if (isSecXbrlShareCountRowConcept(concept)) return true;
  const lab = labelLower(label);
  if (/\bper\s+share\b/.test(lab)) return false;
  return /\bshares?\b/.test(lab) || /\bweighted\s+average\b/.test(lab);
}

function shareCountToWorkbookMillions(v: number): number {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return v / 1_000_000;
  if (abs >= 1_000) return v / 1_000;
  return v;
}

/**
 * Normalize one numeric for Excel export.
 * - `usd_full`: instance/display facts in full USD → sheet shows $ millions (÷ 1e6).
 * - `face_millions`: HTML-face grid already in $ millions → sheet uses as-is.
 */
export type WorkbookNumericScale = "usd_full" | "face_millions";

export function asPresentedWorkbookNumeric(
  concept: string,
  label: string,
  v: number | null,
  scale: WorkbookNumericScale,
  statementKind?: "is" | "bs" | "cf"
): number | "" {
  if (v === null || !Number.isFinite(v)) return "";
  if (isWorkbookEpsRow(concept, label)) return v;
  if (isWorkbookShareCountRow(concept, label, statementKind)) return shareCountToWorkbookMillions(v);
  if (scale === "face_millions") return v;
  return v / 1_000_000;
}

/** Format one as-presented **income / balance / cash** cell for the SEC XBRL tab. */
export function formatSecXAsPresentedCell(concept: string, v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (isSecXbrlShareCountRowConcept(concept)) {
    const millions = v / 1_000_000;
    const sign = millions < 0 ? "-" : "";
    const abs = Math.abs(millions);
    const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
    return `${sign}${s}M`;
  }
  if (isSecXbrlPerShareRowConcept(concept)) {
    const sign = v < 0 ? "−" : "";
    const abs = Math.abs(v);
    const s = abs.toLocaleString(undefined, { maximumFractionDigits: 4, minimumFractionDigits: 0 });
    return `${sign}$${s}`;
  }
  const millions = v / 1_000_000;
  const sign = millions < 0 ? "-" : "";
  const abs = Math.abs(millions);
  const s = abs.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 });
  return `${sign}$${s}M`;
}
