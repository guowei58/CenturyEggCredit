import { getAllFilingsByCik, getCikFromTicker, secRemoteFetchInit, type SecFilingsResult } from "@/lib/sec-edgar";
import type { SecFiling } from "@/lib/sec-edgar";

import { SEC_REQUEST_GAP_MS } from "@/lib/debt-map/constants";

/** Step 1 — Resolve ticker / optional company name / optional CIK → 10-digit CIK + numeric Archives CIK. */
export async function resolveTickerToCIK(input: {
  ticker?: string;
  companyName?: string;
  cik?: string;
}): Promise<{ cikPadded: string; cikNumeric: number; ticker: string | null } | null> {
  const rawCik = input.cik?.trim().replace(/\D/g, "") ?? "";
  if (rawCik.length >= 6 && rawCik.length <= 10) {
    const p = rawCik.padStart(10, "0");
    return {
      cikPadded: p,
      cikNumeric: parseInt(p, 10),
      ticker: input.ticker?.trim().toUpperCase() ?? null,
    };
  }

  const tk = input.ticker?.trim();
  if (tk) {
    const p = await getCikFromTicker(tk);
    if (p) return { cikPadded: p, cikNumeric: parseInt(p, 10), ticker: tk.toUpperCase() };
  }

  const name = input.companyName?.trim();
  if (name) {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", secRemoteFetchInit());
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, { cik_str: number; ticker: string; title: string }>;
    const nLow = name.toLowerCase();
    for (const key of Object.keys(data)) {
      const e = data[key];
      if (!e?.title) continue;
      const tLow = e.title.toLowerCase();
      if (tLow.includes(nLow) || nLow.includes(tLow.slice(0, Math.min(24, tLow.length)))) {
        const p = String(e.cik_str).padStart(10, "0");
        return { cikPadded: p, cikNumeric: e.cik_str, ticker: e.ticker.toUpperCase() };
      }
    }
  }

  return null;
}

/** Step 2 — Company submissions JSON (all chunks) with paced chunk requests. */
export async function fetchCompanySubmissions(cikPadded: string): Promise<SecFilingsResult | null> {
  return getAllFilingsByCik(cikPadded, { paceChunkMs: SEC_REQUEST_GAP_MS });
}

function parseYmd(s: string): Date | null {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Step 2–3 — Filter to debt-relevant forms; prioritize 10-K → 8-K → 10-Q → registration → 424/FWP.
 * Keeps older-than-lookback filings at lower priority (still eligible up to global cap).
 */
export function getRelevantFilings(
  filings: SecFiling[],
  opts: { lookbackYears: number; includeDef14a: boolean }
): SecFiling[] {
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - opts.lookbackYears);

  const debtCue = /debt|indenture|credit|restructuring|merger|exchange|chapter\s*11|notes?\s+due|facility/i;

  const allow = (form: string): boolean => {
    const f = form.trim().toUpperCase();
    if (
      f.startsWith("10-K") ||
      f.startsWith("10-Q") ||
      f.startsWith("8-K") ||
      f.startsWith("S-1") ||
      f.startsWith("S-3") ||
      f.startsWith("S-4") ||
      f.startsWith("F-1") ||
      f.startsWith("F-3") ||
      f.startsWith("F-4") ||
      f.startsWith("424") ||
      f.startsWith("FWP") ||
      f.includes("ABS") ||
      f === "S-11" ||
      f.startsWith("424H") ||
      f.startsWith("424I")
    )
      return true;
    if (f.startsWith("DEF 14A") && opts.includeDef14a) return true;
    return false;
  };

  const priority = (form: string): number => {
    const f = form.trim().toUpperCase();
    if (f.startsWith("10-K")) return 1;
    if (f.startsWith("8-K")) return 2;
    if (f.startsWith("10-Q")) return 3;
    if (f.startsWith("S-") || f.startsWith("F-")) return 4;
    if (f.startsWith("424") || f.startsWith("FWP")) return 5;
    if (f.startsWith("DEF 14A")) return 6;
    return 9;
  };

  const decorated = filings
    .map((x) => {
      const form = x.form.trim();
      if (!allow(form)) return null;
      if (form.startsWith("DEF 14A") && opts.includeDef14a && !debtCue.test(`${x.description} ${x.primaryDocument}`))
        return null;
      const fd = parseYmd(x.filingDate);
      const recentBoost = fd && fd >= cutoff ? 0 : 1;
      return { x, recentBoost, pri: priority(form) };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null);

  decorated.sort((a, b) => {
    if (a.recentBoost !== b.recentBoost) return a.recentBoost - b.recentBoost;
    if (a.pri !== b.pri) return a.pri - b.pri;
    return (b.x.filingDate || "").localeCompare(a.x.filingDate || "");
  });

  return decorated.map((d) => d.x);
}
