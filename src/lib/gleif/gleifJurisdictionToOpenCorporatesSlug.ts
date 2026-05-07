/**
 * Inverse of {@link openCorporatesCodeToGleifJurisdiction}: GLEIF `entity.jurisdiction`
 * → OpenCorporates `/companies/{slug}/{number}` segment (lowercase slug).
 */
export function gleifJurisdictionToOpenCorporatesSlug(gleifJurisdiction: string): string | null {
  const s = gleifJurisdiction.trim().toUpperCase();
  if (!s) return null;

  const us = /^US-([A-Z]{2})$/.exec(s);
  if (us) return `us_${us[1]!.toLowerCase()}`;

  const ca = /^CA-([A-Z]{2})$/.exec(s);
  if (ca) return `ca_${ca[1]!.toLowerCase()}`;

  const au = /^AU-([A-Z]{2})$/.exec(s);
  if (au) return `au_${au[1]!.toLowerCase()}`;

  if (s === "GB-SCT") return "gb_sct";
  if (s === "GB-NIR") return "gb_nir";
  if (s === "GB") return "gb";

  if (/^[A-Z]{2}$/.test(s)) return s.toLowerCase();

  return null;
}
