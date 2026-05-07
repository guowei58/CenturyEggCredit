/**
 * Maps internal OpenCorporates-style jurisdiction codes (from Exhibit 21 mapping)
 * to GLEIF `filter[entity.jurisdiction]` values (ISO 3166-1 / ISO 3166-2).
 */
export function openCorporatesCodeToGleifJurisdiction(ocCode: string): string | null {
  const s = ocCode.trim().toLowerCase();
  if (!s) return null;

  const us = /^us_([a-z]{2})$/.exec(s);
  if (us) return `US-${us[1]!.toUpperCase()}`;

  const ca = /^ca_([a-z]{2})$/.exec(s);
  if (ca) return `CA-${ca[1]!.toUpperCase()}`;

  const au = /^au_([a-z]{2})$/.exec(s);
  if (au) return `AU-${au[1]!.toUpperCase()}`;

  if (s === "gb_sct") return "GB-SCT";
  if (s === "gb_nir") return "GB-NIR";
  if (s === "gb") return "GB";

  if (/^[a-z]{2}$/.test(s)) return s.toUpperCase();

  return null;
}
