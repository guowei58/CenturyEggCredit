import type { DebtDocumentTableRow, EdgarDebtDocSearchResult } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import { resolveDebtDocumentDisplayTitle } from "@/lib/creditDocs/sanitizeSecInstrumentTitle";

import type { DebtInventoryItem } from "@/lib/entity-mapper-v2/types";

function inferCategory(docType: string, notes: string): string {
  const b = `${docType} ${notes}`.toLowerCase();
  if (/amendment|waiver|consent/.test(b)) return "Amendment / waiver / consent";
  if (/joinder/.test(b)) return "Joinder";
  if (/supplemental\s+indenture/.test(b)) return "Supplemental indenture";
  if (/indenture/.test(b)) return "Indenture / notes";
  if (/credit|facility|loan|abl|revolv/.test(b)) return "Credit agreement / facility";
  if (/guarantee|guaranty/.test(b)) return "Guarantee";
  if (/pledge|collateral|security/.test(b)) return "Collateral / security";
  if (/intercreditor/.test(b)) return "Intercreditor";
  return "Other financing";
}

function inferFamily(row: DebtDocumentTableRow): string {
  const dt = `${row.documentType} ${row.instrumentOrFacilityName}`.toLowerCase();
  if (/dip|debtor-in-possession/.test(dt)) return "DIP facility";
  if (/exit\s+facility|exit\s+financing/.test(dt)) return "Exit facility";
  if (/credit|term loan|revolv|abl|facility/.test(dt)) return "Revolver / term / ABL credit facility";
  if (/secured/.test(dt) && /note|indenture/.test(dt)) return "Senior secured notes";
  if (/indenture|form of note|global note/.test(dt)) return "Notes / indenture";
  if (/convertible|exchangeable/.test(dt)) return "Convertible / exchangeable notes";
  if (/abs|securitization|receivable/.test(dt)) return "Securitization / receivables facility";
  return "Other financing arrangement";
}

export function debtInventoryFromEdgarSearch(result: EdgarDebtDocSearchResult): {
  items: DebtInventoryItem[];
  families: string[];
} {
  const items: DebtInventoryItem[] = [];
  const famSet = new Set<string>();

  for (const r of result.table) {
    const family = inferFamily(r);
    famSet.add(family);
    items.push({
      documentName: resolveDebtDocumentDisplayTitle(r.instrumentOrFacilityName.trim(), {
        exhibitNumber: r.exhibitNumber,
        filingForm: r.filingForm,
        filingDate: r.filingDate,
        directExhibitLink: r.directExhibitLink,
      }).slice(0, 500),
      documentType: r.documentType,
      facilityInstrumentFamily: family,
      filingForm: r.filingForm,
      filingDate: r.filingDate,
      accessionNumber: r.accessionNumber,
      exhibitNumber: r.exhibitNumber,
      directExhibitLink: r.directExhibitLink,
      filingLink: r.filingLink,
      documentDate: r.filingDate,
      docCategory: inferCategory(r.documentType, r.notesWhyRelevant),
      baseAgreementRelatesTo: "",
      currentHistoricalUnclear: r.status === "Superseded" ? "Historical" : "Unclear",
      confidence: r.confidenceLevel,
      notes: r.notesWhyRelevant.slice(0, 800),
    });
  }

  return { items, families: [...famSet].sort() };
}
