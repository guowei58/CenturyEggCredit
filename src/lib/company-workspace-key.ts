/** Client-safe workspace key helpers (no Node / SEC imports). */

/** Normalize user CIK input to 10-digit string or null. */
export function normalizeCikInput(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 1 || digits.length > 10) return null;
  return digits.padStart(10, "0");
}

/** True when the workspace key is a zero-padded 10-digit SEC CIK. */
export function isCikWorkspaceKey(key: string): boolean {
  return /^\d{10}$/.test(key.trim());
}

/** Sidebar / company bar badge label. */
export function formatWorkspaceBadge(key: string): string {
  const t = key.trim();
  return isCikWorkspaceKey(t) ? `CIK ${t}` : t.toUpperCase();
}

/**
 * Parse user lookup input into CIK or ticker form.
 * CIK: optional `CIK` prefix, or 6–10 digits only. Shorter all-digit strings are treated as tickers first.
 */
export function parseCompanyLookupInput(raw: string): { kind: "cik" | "ticker"; normalized: string } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutCikPrefix = trimmed.replace(/^CIK[#:\s-]*/i, "").trim();
  const digitsOnly = withoutCikPrefix.replace(/\D/g, "");
  const explicitCik = /^CIK/i.test(trimmed);
  const looksLikeBareCik =
    digitsOnly.length >= 6 &&
    digitsOnly.length <= 10 &&
    /^\d[\d\s.-]*$/.test(withoutCikPrefix);

  if (explicitCik || looksLikeBareCik) {
    const cik = normalizeCikInput(withoutCikPrefix);
    if (cik) return { kind: "cik", normalized: cik };
  }

  const ticker = trimmed
    .toUpperCase()
    .replace(/[^A-Z0-9.-]/g, "");
  if (!ticker || ticker.length > 12) return null;
  return { kind: "ticker", normalized: ticker };
}
