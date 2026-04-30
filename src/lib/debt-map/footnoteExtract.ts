import { stripHtmlToDebtPlainText } from "@/lib/debt-map/textExtractor";

export type FootnoteLine = {
  description: string;
  principalAmount: string | null;
  carryingValue: string | null;
  maturityDate: string | null;
  rate: string | null;
};

/**
 * Heuristic extraction of lines that look like debt table rows in a 10-K/10-Q (MVP).
 */
export function extractDebtFootnoteRows(text: string, maxRows = 45): FootnoteLine[] {
  const plain = text.includes("<") ? stripHtmlToDebtPlainText(text) : text;
  const out: FootnoteLine[] = [];
  const lines = plain.split(/\n/);

  let inDebtish = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line.length < 6) continue;
    if (/long-term debt|borrowings|debt and|notes?\s+and|credit facilities|outstanding debt|maturities of debt/i.test(line)) {
      inDebtish = true;
    }
    if (inDebtish && /^(consolidated|the following|our|as of|total|less|add)/i.test(line) && line.length < 80) {
      continue;
    }
    if (inDebtish && (/\$|million|billion|mm\b|due\s+20|%\s*per|LIBOR|SOFR|interest rate/i.test(line) || /20\d{2}/.test(line))) {
      const amt = line.match(/\$\s*([\d,]+(?:\.\d+)?)/);
      const rate = line.match(/\b(\d+(?:\.\d+)?)\s*%/);
      const mat = line.match(/\b(20\d{2}-\d{2}-\d{2}|(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*20\d{2})\b/);
      out.push({
        description: line.slice(0, 400),
        principalAmount: amt ? amt[0]! : null,
        carryingValue: null,
        maturityDate: mat ? mat[0]! : null,
        rate: rate ? `${rate[1]}%` : null,
      });
      if (out.length >= maxRows) break;
    }
    if (inDebtish && out.length > 0 && /^note\s+\d+[.:]/i.test(line)) break;
  }

  return out;
}
