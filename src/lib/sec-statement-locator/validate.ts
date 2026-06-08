import type { FilingHtmlStatement } from "@/lib/sec-filing-financials";

export type PacketValidation = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
};

function findRowValue(stmt: FilingHtmlStatement, pattern: RegExp): number | null {
  const row = stmt.rows.find((r) => pattern.test(r.label));
  if (!row) return null;
  const key = stmt.periods[stmt.periods.length - 1]?.key ?? stmt.periods[0]?.key;
  if (!key) return null;
  const v = row.values[key];
  return v !== null && v !== undefined && Number.isFinite(v) ? v : null;
}

function approxEqual(a: number | null, b: number | null, toleranceRatio = 0.05): boolean {
  if (a === null || b === null) return true;
  const denom = Math.max(Math.abs(a), Math.abs(b), 1);
  return Math.abs(a - b) / denom <= toleranceRatio;
}

/** Post-selection sanity checks across IS / BS / CF. */
export function validateStatementPacket(
  statements: FilingHtmlStatement[],
  form: string
): PacketValidation {
  const checks: PacketValidation["checks"] = [];
  const is = statements.find((s) => s.id === "income-statement");
  const bs = statements.find((s) => s.id === "balance-sheet");
  const cf = statements.find((s) => s.id === "cash-flow");

  if (!is || !bs || !cf) {
    checks.push({ id: "trio_present", ok: false, detail: "missing one or more primary statements" });
    return { ok: false, checks };
  }
  checks.push({ id: "trio_present", ok: true, detail: "IS, BS, CF all present" });

  const totalAssets = findRowValue(bs, /\btotal\s+assets\b/i);
  const totalLiabEquity = findRowValue(bs, /\btotal\s+liabilit(?:ies|y)\s+and\s+(?:stockholders|shareholders)/i);
  if (totalAssets !== null && totalLiabEquity !== null) {
    const ok = approxEqual(totalAssets, totalLiabEquity, 0.08);
    checks.push({
      id: "bs_balances",
      ok,
      detail: ok
        ? "total assets ≈ total liabilities and equity"
        : `total assets ${totalAssets} vs L+E ${totalLiabEquity}`,
    });
  }

  const cfNetIncome = findRowValue(cf, /\bnet\s+(?:income|loss)\b/i);
  const isNetIncome = findRowValue(is, /\bnet\s+(?:income|loss)\b/i);
  if (cfNetIncome !== null && isNetIncome !== null) {
    const ok = approxEqual(cfNetIncome, isNetIncome, form.includes("10-Q") ? 0.15 : 0.08);
    checks.push({
      id: "cf_is_net_income",
      ok,
      detail: ok ? "CF net income ≈ IS net income" : `CF ${cfNetIncome} vs IS ${isNetIncome}`,
    });
  }

  const bsCash = findRowValue(bs, /\bcash\s+and\s+cash\s+equivalents\b/i);
  const cfEndCash = findRowValue(cf, /\bcash\s+at\s+end\s+of\s+(?:the\s+)?period\b/i);
  if (bsCash !== null && cfEndCash !== null) {
    const ok = approxEqual(bsCash, cfEndCash, 0.12);
    checks.push({
      id: "cf_bs_cash",
      ok,
      detail: ok ? "CF ending cash ≈ BS cash" : `CF end ${cfEndCash} vs BS cash ${bsCash}`,
    });
  }

  const cfBegin = findRowValue(cf, /\bcash\s+at\s+beginning\s+of\s+(?:the\s+)?period\b/i);
  const cfEnd = findRowValue(cf, /\bcash\s+at\s+end\s+of\s+(?:the\s+)?period\b/i);
  const op = findRowValue(cf, /\bnet\s+cash\s+(?:provided|used)\s+by\s+operating\s+activities\b/i);
  const inv = findRowValue(cf, /\bnet\s+cash\s+(?:provided|used)\s+by\s+investing\s+activities\b/i);
  const fin = findRowValue(cf, /\bnet\s+cash\s+(?:provided|used)\s+by\s+financing\s+activities\b/i);
  if (cfBegin !== null && cfEnd !== null && op !== null && inv !== null && fin !== null) {
    const roll = cfBegin + op + inv + fin;
    const ok = approxEqual(roll, cfEnd, 0.15);
    checks.push({
      id: "cf_rollforward",
      ok,
      detail: ok ? "CF rollforward approximately ties" : `begin+flows ${roll} vs end ${cfEnd}`,
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}
