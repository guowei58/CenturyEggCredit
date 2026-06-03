/**
 * For non-financial filers, simplify the income statement face:
 * - Drop continuing vs discontinued operating split lines (keep consolidated net / pretax / operating).
 * - Drop other comprehensive income bridge lines and comprehensive income totals (keep net income).
 *
 * Financial-sector filers (see {@link isFinancialServicesFromInstanceXml}) keep full presentation.
 */

import type { PresentedStatementRow } from "@/lib/sec-xbrl-as-presented";

function locConcept(concept: string): string {
  const i = concept.lastIndexOf(":");
  const name = i >= 0 ? concept.slice(i + 1) : concept;
  return name.replace(/_/g, "").toLowerCase();
}

function normLabel(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Never suppress these anchors (concept tail match after normalization). */
function isIncomeStatementAnchor(loc: string): boolean {
  if (loc.includes("operatingincomeloss")) return true;
  if (/incomelossfromcontinuingoperationsbefore/.test(loc)) return true;
  if (/incomefromcontinuingoperationsbefore/i.test(loc)) return true;
  if (/income.*before.*incometax|incomelossbeforeincometax/i.test(loc)) return true;
  if (/incometaxexpensebenefit|provisionforincometaxe/i.test(loc)) return true;
  if (loc.includes("revenue") || loc.includes("salesrevenue") || loc.includes("costofrevenue")) return true;
  if (loc.includes("costsandexpenses")) return true;
  return false;
}

/**
 * Rows to drop on non-financial filers: post-tax continuing/discontinued split, OCI / comprehensive income ladder.
 */
export function shouldSuppressNonFinancialIncomeRow(concept: string, label: string): boolean {
  const L = locConcept(concept);
  const lab = normLabel(label);

  if (isIncomeStatementAnchor(L)) return false;

  // --- Continuing / discontinued operations (after-tax path) ---
  // Avoid matching **NotDiscontinued** in QNames (e.g. `DisposalGroupNotDiscontinuedOperationGainLossOnDisposal`),
  // which is a continuing-ops disposal line and must stay on the face.
  if (
    (/discontinued/i.test(L) && !/notdiscontinued/i.test(L)) ||
    /disposalgroupincludingdiscontinued/i.test(L)
  )
    return true;
  // Taxonomy/documentation labels literally say "... Not Discontinued Operation ...".
  // Match `operation`/`component`, but exclude **not discontinued** (continuing‑ops disposal), same as QName rules above.
  if (
    /\bdiscontinued\b/i.test(lab) &&
    !/not\s+discontinued/i.test(lab) &&
    /operation|component/i.test(lab)
  )
    return true;

  if (/incomelossfromcontinuingoperations$/i.test(L)) return true;
  if (/^incomefromcontinuingoperations$/i.test(L)) return true;
  if (/incomelossfromcontinuingoperations(net)?$/i.test(L) && !/before|pretax|tax|extraordinary/i.test(L)) return true;

  if (/profitlossfromcontinuingoperations$/i.test(L)) return true;

  if (/incomelossfromcontinuingoperationsper/i.test(L)) return true;
  if (/weightedaveragenumber.*continuing/i.test(L)) return true;
  if (/weightedaveragenumber.*discontinued/i.test(L)) return true;

  if (/earningspershare.*continuing/i.test(L)) return true;
  if (/earningspershare.*discontinued/i.test(L)) return true;
  if (/eps.*continuing|eps.*discontinued/i.test(L)) return true;

  // Section headers (often unlabeled extensions)
  if (lab === "continuing operations" || lab === "discontinued operations") return true;
  if (/^continuing operations$/i.test(lab) || /^discontinued operations$/i.test(lab)) return true;

  // --- Other comprehensive income & comprehensive income (face “math” below net income) ---
  if (/othercomprehensiveincome/i.test(L)) return true;
  if (/comprehensiveincome/i.test(L)) return true;
  if (/accumulatedothercomprehensive/i.test(L)) return true;

  if (/\bother comprehensive income\b/i.test(lab)) return true;
  if (/\bcomprehensive income\b/i.test(lab) && !/net income/i.test(lab)) return true;
  if (/\bunrealized .*(gain|loss).*(investment|security|derivative)/i.test(lab)) return true;
  if (/foreign currency.*other comprehensive|oci.*foreign currency/i.test(lab)) return true;

  return false;
}

export function filterNonFinancialIncomeStatementRows(
  rows: PresentedStatementRow[],
  financialFiler: boolean
): PresentedStatementRow[] {
  if (financialFiler || rows.length === 0) return rows;
  return rows.filter((r) => !shouldSuppressNonFinancialIncomeRow(r.concept, r.label));
}
