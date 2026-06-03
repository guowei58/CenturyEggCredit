/**
 * Heuristic: banks, insurers, REITs, and similar filers (SIC 6000–6799 or select NAICS) where we keep
 * full comprehensive income and continuing / discontinued detail on the face.
 */

const SIC_FINANCIAL_MIN = 6000;
const SIC_FINANCIAL_MAX = 6799;

/** NAICS 2022 sectors typically used for “financial services” filers on the face statement. */
const NAICS_FINANCIAL_PREFIXES = [
  "522", // Credit intermediation
  "523", // Securities / commodities
  "524", // Insurance
  "525", // Funds / trusts
  "531", // Real estate (incl. REIT-style lessors)
];

function firstFourDigitSicFromText(s: string): number | null {
  const m = s.match(/\b(\d{4})\b/);
  if (!m) return null;
  const n = parseInt(m[1]!, 10);
  return n >= 1000 && n <= 9999 ? n : null;
}

/** Any 6-digit NAICS codes in text; return true if any prefix matches financial list. */
function naicsTextIndicatesFinancial(s: string): boolean {
  const codes = s.match(/\b(\d{6})\b/g);
  if (!codes?.length) return false;
  for (const c of codes) {
    const p3 = c.slice(0, 3);
    if (NAICS_FINANCIAL_PREFIXES.includes(p3)) return true;
  }
  return false;
}

/**
 * Scan raw instance/iXBRL XML for DEI / industry strings (not limited to presentation concept set).
 */
export function isFinancialServicesFromInstanceXml(instanceXml: string): boolean {
  if (!instanceXml || instanceXml.length < 100) return false;

  const tagTexts: string[] = [];
  const tagRes = [
    /StandardIndustrialClassification[^>]*>([^<]+)</gi,
    /IndustryClassification[^>]*>([^<]+)</gi,
    /SIC[^>]{0,80}>([^<]{1,120})</gi,
  ];
  for (const re of tagRes) {
    let m: RegExpExecArray | null;
    const r = new RegExp(re.source, re.flags);
    while ((m = r.exec(instanceXml)) !== null) {
      const t = m[1]?.trim();
      if (t) tagTexts.push(t);
    }
  }

  for (const t of tagTexts) {
    const sic = firstFourDigitSicFromText(t);
    if (sic != null && sic >= SIC_FINANCIAL_MIN && sic <= SIC_FINANCIAL_MAX) {
      return true;
    }
    if (naicsTextIndicatesFinancial(t)) {
      return true;
    }
  }

  return false;
}
