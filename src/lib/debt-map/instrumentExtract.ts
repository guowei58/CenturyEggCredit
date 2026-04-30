import { confidencePartyBlockLine, clampConfidence } from "@/lib/debt-map/confidence";
import type { DocumentClassification } from "@/lib/debt-map/documentClassifier";

export type InstrumentStub = {
  instrumentName: string;
  instrumentType: string;
  principalAmount: string | null;
  couponOrRate: string | null;
  maturityDate: string | null;
  securedStatus: string | null;
  sourceSnippet: string;
  confidenceScore: number;
};

function detectInstrumentType(head: string): string {
  const t = head.toLowerCase();
  if (t.includes("asset-based") && t.includes("credit")) return "ABL";
  if (t.includes("revolving credit") || t.includes("revolver")) return "revolving credit facility";
  if (t.includes("term loan") || t.includes("term b")) return "term loan";
  if (t.includes("senior secured") && t.includes("note")) return "senior secured notes";
  if (t.includes("senior") && t.includes("unsecured") && t.includes("note")) return "senior unsecured notes";
  if (t.includes("subordinated") && t.includes("note")) return "subordinated notes";
  if (t.includes("convertible") && t.includes("note")) return "convertible notes";
  if (t.includes("receivables") && t.includes("facility")) return "receivables facility";
  if (t.includes("securitization") || t.includes("special purpose")) return "securitization";
  if (t.includes("credit agreement")) return "term loan/revolver (credit agreement)";
  if (t.includes("indenture")) return "senior notes (indenture)";
  return "other";
}

/**
 * Heuristic instrument row from the opening of a debt exhibit (MVP — verify in source).
 */
export function extractInstrumentStub(
  fileName: string,
  text: string,
  _classification: DocumentClassification
): InstrumentStub {
  const head = text.slice(0, 12_000);
  const lines = head
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let instrumentName = fileName.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  for (const line of lines.slice(0, 50)) {
    if (line.length > 8 && line.length < 220 && /indenture|credit agreement|supplemental|notes due|guarantee/i.test(line)) {
      instrumentName = line;
      break;
    }
  }

  const amt =
    head.match(/\$\s*([\d,]+(?:\.\d+)?)\s*(million|billion|mm|MM|bn|BN)?/i) ??
    head.match(/(?:aggregate|principal)\s+(?:amount|principal)?[^$]{0,24}\$\s*([\d,]+(?:\.\d+)?)/i);

  const maturity =
    head.match(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d{2}\b/
    ) ?? head.match(/\b20\d{2}-\d{2}-\d{2}\b/);

  const coupon = head.match(/\b(\d+(?:\.\d+)?)\s*%\s*(?:per\s+annum|p\.a\.)?/i);

  let securedStatus: string | null = null;
  if (/\bsecured\b/i.test(head) && !/\bunsecured\b/i.test(head)) securedStatus = "secured";
  else if (/\bunsecured\b/i.test(head)) securedStatus = "unsecured";

  const instrumentType = detectInstrumentType(head);
  const sourceSnippet = lines.slice(0, 6).join(" · ").slice(0, 450);

  return {
    instrumentName: instrumentName.slice(0, 500),
    instrumentType,
    principalAmount: amt ? (amt[0] as string).trim().slice(0, 80) : null,
    couponOrRate: coupon ? `${coupon[1]}%` : null,
    maturityDate: maturity ? maturity[0]!.slice(0, 40) : null,
    securedStatus,
    sourceSnippet,
    confidenceScore: clampConfidence(confidencePartyBlockLine() - (instrumentType === "other" ? 15 : 0)),
  };
}
