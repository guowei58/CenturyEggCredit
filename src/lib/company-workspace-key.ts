/** Client-safe workspace key helpers (no Node / SEC imports). */

export const PRIVATE_WORKSPACE_PREFIX = "PRIV";

const PRIVATE_WORKSPACE_SUFFIX_MAX = 8;

/** True when the workspace key is a private (non-SEC) company slug. */
export function isPrivateWorkspaceKey(key: string): boolean {
  return /^PRIV[A-Z0-9]{1,8}$/i.test(key.trim());
}

/** Alphanumeric slug from a company name (max 8 chars, used after PRIV). */
export function privateWorkspaceSlugFromName(displayName: string): string {
  return displayName
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, PRIVATE_WORKSPACE_SUFFIX_MAX);
}

/** Suffix after the PRIV prefix, e.g. MIXBOOK from PRIVMIXBOOK. */
export function privateWorkspaceSlugFromKey(key: string): string {
  const t = key.trim().toUpperCase();
  if (!isPrivateWorkspaceKey(t)) return "";
  return t.slice(PRIVATE_WORKSPACE_PREFIX.length);
}

/** Best-effort readable name from a private key when stored metadata is missing. */
export function privateWorkspaceSlugToDisplayName(slug: string): string {
  const s = slug.trim();
  if (!s) return "Private company";
  return s.charAt(0) + s.slice(1).toLowerCase();
}

/** Display name for a private workspace: prefer stored metadata, else decode the PRIV slug. */
export function privateWorkspaceDisplayName(key: string, storedName?: string | null): string {
  const stored = storedName?.trim();
  const badge = formatWorkspaceBadge(key).toUpperCase();
  if (stored && stored.toUpperCase() !== badge) return stored;
  return privateWorkspaceSlugToDisplayName(privateWorkspaceSlugFromKey(key));
}

/** Stable workspace key for a private company (PRIV + name slug, max 12 chars). */
export function privateWorkspaceKeyFromName(displayName: string): string {
  const slug = privateWorkspaceSlugFromName(displayName);
  return `${PRIVATE_WORKSPACE_PREFIX}${slug || "CO"}`;
}

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
  if (isCikWorkspaceKey(t)) return `CIK ${t}`;
  if (isPrivateWorkspaceKey(t)) {
    const slug = privateWorkspaceSlugFromKey(t);
    return slug ? `PRIV${slug}` : "PRIVATE";
  }
  return t.toUpperCase();
}

/**
 * Parse user lookup input into CIK, ticker, or company name.
 * CIK: optional `CIK` prefix, or 6–10 digits only.
 * Ticker: single token (case-insensitive), including lowercase symbols like `gen` → `GEN`.
 * Name: multi-word / punctuation inputs (resolved as private workspace when not on SEC).
 */
export function parseCompanyLookupInput(
  raw: string
): { kind: "cik" | "ticker" | "name"; normalized: string } | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 120) return null;

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

  // Multi-word / punctuation inputs are company names; single tokens (any case) try SEC ticker first.
  const hasNameLikeSpacing = /[\s,;"&()]/.test(trimmed) || /'/.test(trimmed);
  if (hasNameLikeSpacing) {
    return { kind: "name", normalized: trimmed };
  }

  const ticker = trimmed.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!ticker) return null;
  if (ticker.length > 12) return { kind: "name", normalized: trimmed };
  return { kind: "ticker", normalized: ticker };
}

/** Normalize workspace key for API routes and Postgres (CIK, PRIV slug, or ticker). */
export function sanitizeWorkspaceKey(raw: string): string | null {
  const t = raw.trim();
  if (!t) return null;
  if (isCikWorkspaceKey(t)) return t;
  if (isPrivateWorkspaceKey(t)) return t.toUpperCase();
  const ticker = t.toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return ticker.length > 0 && ticker.length <= 12 ? ticker : null;
}
