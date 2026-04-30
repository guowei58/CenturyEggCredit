import type { SecFiling } from "@/lib/sec-edgar";
import { DEBT_PRIORITY_FORMS } from "@/lib/debt-map/constants";

function parseUsDateYmd(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(t + "T12:00:00Z");
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Filter SEC filings to debt-relevant forms within lookback years.
 */
export function filterFilingsForDebtMap(
  filings: SecFiling[],
  lookbackYears: number,
  opts: { include8K: boolean; includeRegistration: boolean; includeDef14a: boolean }
): SecFiling[] {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setFullYear(cutoff.getFullYear() - lookbackYears);

  const out: SecFiling[] = [];
  for (const f of filings) {
    const fd = parseUsDateYmd(f.filingDate);
    if (fd && fd < cutoff) continue;

    const form = (f.form ?? "").trim();
    if (!form) continue;

    if (form === "8-K" && !opts.include8K) continue;
    if (form === "DEF 14A" && !opts.includeDef14a) continue;
    if (!opts.includeRegistration && (form === "S-1" || form === "S-3" || form === "S-4" || form.startsWith("424")))
      continue;

    if (DEBT_PRIORITY_FORMS.has(form) || form.startsWith("424")) {
      out.push(f);
    }
  }
  return out;
}
