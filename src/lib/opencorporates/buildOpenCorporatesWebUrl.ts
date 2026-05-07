import { gleifJurisdictionToOpenCorporatesSlug } from "@/lib/gleif/gleifJurisdictionToOpenCorporatesSlug";

const OC_BASE = "https://opencorporates.com";

function looksLikeLeiId(s: string): boolean {
  const t = s.replace(/\s/g, "");
  return t.length === 20 && /^[0-9A-Z]{20}$/i.test(t);
}

/**
 * Best-effort OpenCorporates URL for a subsidiary row (GLEIF-backed).
 * Uses registry-style `companyNumber` + `ocJurisdiction` (GLEIF region) when they map to an OC company path;
 * otherwise falls back to OC search using the matched legal name (or Exhibit name).
 */
export function buildOpenCorporatesWebUrl(row: {
  ocJurisdiction?: unknown;
  companyNumber?: unknown;
  matchedName?: unknown;
  exhibitLegalName?: unknown;
}): string | null {
  const matched = String(row.matchedName ?? "").trim();
  const exhibit = String(row.exhibitLegalName ?? "").trim();
  const queryName = matched || exhibit;

  const searchUrl = (): string | null =>
    queryName ? `${OC_BASE}/companies?q=${encodeURIComponent(queryName)}` : null;

  const j = String(row.ocJurisdiction ?? "").trim();
  const cn = String(row.companyNumber ?? "").trim();
  if (!j || !cn) return searchUrl();

  /** Stored `companyNumber` may be an LEI when no registry id — OC path needs registry #. */
  if (looksLikeLeiId(cn)) return searchUrl();

  const slug = gleifJurisdictionToOpenCorporatesSlug(j);
  if (!slug) return searchUrl();

  return `${OC_BASE}/companies/${slug}/${encodeURIComponent(cn)}`;
}
