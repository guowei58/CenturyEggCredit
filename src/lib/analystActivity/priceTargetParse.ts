const PT_CURRENCY = /(?:US\$|USD\s*\$|\$|€|£|CAD\s*\$|C\$)\s*([\d,]+(?:\.\d{1,2})?)/gi;
const PT_FROM_TO =
  /(?:price\s+target|pt|target\s+price)\s+(?:to|at|of)\s*(?:US\$|USD\s*\$|\$|€|£)?\s*([\d,]+(?:\.\d{1,2})?)\s*(?:from|vs\.?|versus)\s*(?:US\$|USD\s*\$|\$|€|£)?\s*([\d,]+(?:\.\d{1,2})?)/i;
const PT_TO_ONLY =
  /(?:raises?|boosts?|lifts?|cuts?|lowers?|reduces?|sets?|price\s+target|pt|target\s+price)\s+(?:to|at|of)\s*(?:US\$|USD\s*\$|\$|€|£|CAD\s*\$|C\$)\s*([\d,]+(?:\.\d{1,2})?)/i;

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, ""));
}

function detectCurrency(text: string): string | null {
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  if (/CAD|C\$/.test(text)) return "CAD";
  if (/\$|USD|US\$/.test(text)) return "USD";
  return null;
}

export function parsePriceTargets(text: string): {
  prior: number | null;
  current: number | null;
  currency: string | null;
} {
  const fromTo = text.match(PT_FROM_TO);
  if (fromTo) {
    return {
      prior: parseNum(fromTo[2]),
      current: parseNum(fromTo[1]),
      currency: detectCurrency(text),
    };
  }
  const toOnly = text.match(PT_TO_ONLY);
  if (toOnly) {
    return {
      prior: null,
      current: parseNum(toOnly[1]),
      currency: detectCurrency(text),
    };
  }
  const amounts: number[] = [];
  let m: RegExpExecArray | null;
  const re = new RegExp(PT_CURRENCY.source, "gi");
  while ((m = re.exec(text)) !== null) {
    amounts.push(parseNum(m[1]));
  }
  if (amounts.length >= 2) {
    return { prior: amounts[amounts.length - 2], current: amounts[amounts.length - 1], currency: detectCurrency(text) };
  }
  if (amounts.length === 1) {
    return { prior: null, current: amounts[0], currency: detectCurrency(text) };
  }
  return { prior: null, current: null, currency: null };
}

export function formatPtChange(prior: number | null, current: number | null, currency: string | null): string {
  const sym = currency === "EUR" ? "€" : currency === "GBP" ? "£" : "$";
  if (prior != null && current != null) return `${sym}${prior} → ${sym}${current}`;
  if (current != null) return `${sym}${current}`;
  return "—";
}
