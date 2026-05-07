/**
 * Exhibit 21 / profile jurisdiction text → OpenCorporates `jurisdiction_code`.
 * Edit this table as needed — keys are matched after lowercasing + light punctuation strip.
 */
export const OPENCORPORATES_JURISDICTION_MAP: Record<string, string> = {
  // United States — states (full names + abbreviations)
  alabama: "us_al",
  alaska: "us_ak",
  arizona: "us_az",
  arkansas: "us_ar",
  california: "us_ca",
  colorado: "us_co",
  connecticut: "us_ct",
  delaware: "us_de",
  de: "us_de",
  "district of columbia": "us_dc",
  dc: "us_dc",
  florida: "us_fl",
  georgia: "us_ga",
  hawaii: "us_hi",
  idaho: "us_id",
  illinois: "us_il",
  indiana: "us_in",
  iowa: "us_ia",
  kansas: "us_ks",
  kentucky: "us_ky",
  louisiana: "us_la",
  maine: "us_me",
  maryland: "us_md",
  massachusetts: "us_ma",
  michigan: "us_mi",
  minnesota: "us_mn",
  mississippi: "us_ms",
  missouri: "us_mo",
  montana: "us_mt",
  nebraska: "us_ne",
  nevada: "us_nv",
  "new hampshire": "us_nh",
  "new jersey": "us_nj",
  "new mexico": "us_nm",
  "new york": "us_ny",
  ny: "us_ny",
  "north carolina": "us_nc",
  "north dakota": "us_nd",
  ohio: "us_oh",
  oklahoma: "us_ok",
  oregon: "us_or",
  pennsylvania: "us_pa",
  "rhode island": "us_ri",
  "south carolina": "us_sc",
  "south dakota": "us_sd",
  tennessee: "us_tn",
  texas: "us_tx",
  tx: "us_tx",
  utah: "us_ut",
  vermont: "us_vt",
  virginia: "us_va",
  washington: "us_wa",
  "west virginia": "us_wv",
  wisconsin: "us_wi",
  wyoming: "us_wy",

  // Common Exhibit 21 variants
  usa: "us_de",
  "united states": "us_de",
  /** Bare “US” — no single OC jurisdiction */
  us: "us_de",

  // International — examples from spec + common
  "united kingdom": "gb",
  uk: "gb",
  england: "gb",
  "england and wales": "gb",
  scotland: "gb_sct",
  "northern ireland": "gb_nir",
  wales: "gb",

  canada: "ca",
  /** Province codes — OC */
  ontario: "ca_on",
  "british columbia": "ca_bc",
  alberta: "ca_ab",
  quebec: "ca_qc",

  luxembourg: "lu",
  netherlands: "nl",
  holland: "nl",
  ireland: "ie",
  spain: "es",
  mauritius: "mu",
  france: "fr",
  germany: "de",
  switzerland: "ch",
  japan: "jp",
  china: "cn",
  india: "in",
  australia: "au",
  "hong kong": "hk",
  singapore: "sg",
  brazil: "br",
  mexico: "mx",
  "cayman islands": "ky",
  cayman: "ky",
  bermuda: "bm",
  jersey: "je",
  guernsey: "gg",
};

/** Normalize exhibit jurisdiction text before lookup. */
export function normalizeJurisdictionKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/\s+/g, " ");
}

export type JurisdictionMapOutcome =
  | { kind: "mapped"; ocCode: string }
  | { kind: "unmapped"; reason: "empty" | "unknown_label" };

/** Do not use these map keys as leading-prefix hints — too ambiguous vs Exhibit text. */
const US_PREFIX_BLOCKLIST = new Set(["usa", "us", "united states"]);

/** Full / multi-word US state labels from `OPENCORPORATES_JURISDICTION_MAP`, longest first (for prefix match). */
function usStatePrefixKeysSorted(): string[] {
  return Object.entries(OPENCORPORATES_JURISDICTION_MAP)
    .filter(([k, v]) => /^us_[a-z]{2}$/.test(v) && !US_PREFIX_BLOCKLIST.has(k))
    .filter(([k]) => k.length >= 4 || k.includes(" "))
    .map(([k]) => k)
    .sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** Exhibit 21 domicile lines often read "Delaware limited liability company" — extract leading state before suffix noise. */
function matchLeadingUsStateCode(normalized: string): string | null {
  for (const key of usStatePrefixKeysSorted()) {
    if (normalized === key || normalized.startsWith(`${key} `) || normalized.startsWith(`${key},`)) {
      return OPENCORPORATES_JURISDICTION_MAP[key];
    }
  }
  return null;
}

const CORPORATE_JURISDICTION_SUFFIX: RegExp[] = [
  /\s+limited liability company$/i,
  /\s+professional limited liability company$/i,
  /\s+l\.l\.c\.?$/i,
  /\s+llc$/i,
  /\s+limited partnership$/i,
  /\s+l\.l\.p\.?$/i,
  /\s+llp$/i,
  /\s+limited$/i,
  /\s+incorporated$/i,
  /\s+inc\.?$/i,
  /\s+corp\.?$/i,
  /\s+corporation$/i,
  /\s+company$/i,
  /\s+co\.?$/i,
  /\s+plc$/i,
  /\s+trust$/i,
  /\s+partnership$/i,
];

/** Yield shorter strings by stripping trailing entity-type phrases (e.g. "DE LLC" → "de"). */
function expandJurisdictionVariants(normalized: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (s: string) => {
    const x = s.trim().replace(/\s+/g, " ");
    if (x && !seen.has(x)) {
      seen.add(x);
      out.push(x);
    }
  };
  add(normalized);
  let cur = normalized;
  for (let i = 0; i < 12; i++) {
    let shorter = false;
    for (const re of CORPORATE_JURISDICTION_SUFFIX) {
      const n = cur.replace(re, "").trim();
      if (n.length && n.length < cur.length) {
        cur = n;
        add(cur);
        shorter = true;
        break;
      }
    }
    if (!shorter) break;
  }
  return out;
}

/** US postal abbreviations → OC `us_xx` (Exhibit 21 domicile column). */
const US_STATE_ABBR_TO_OC: Record<string, string> = {
  al: "us_al",
  ak: "us_ak",
  az: "us_az",
  ar: "us_ar",
  ca: "us_ca",
  co: "us_co",
  ct: "us_ct",
  de: "us_de",
  fl: "us_fl",
  ga: "us_ga",
  hi: "us_hi",
  id: "us_id",
  il: "us_il",
  in: "us_in",
  ia: "us_ia",
  ks: "us_ks",
  ky: "us_ky",
  la: "us_la",
  me: "us_me",
  md: "us_md",
  ma: "us_ma",
  mi: "us_mi",
  mn: "us_mn",
  ms: "us_ms",
  mo: "us_mo",
  mt: "us_mt",
  ne: "us_ne",
  nv: "us_nv",
  nh: "us_nh",
  nj: "us_nj",
  nm: "us_nm",
  ny: "us_ny",
  nc: "us_nc",
  nd: "us_nd",
  oh: "us_oh",
  ok: "us_ok",
  or: "us_or",
  pa: "us_pa",
  ri: "us_ri",
  sc: "us_sc",
  sd: "us_sd",
  tn: "us_tn",
  tx: "us_tx",
  ut: "us_ut",
  vt: "us_vt",
  va: "us_va",
  wa: "us_wa",
  wv: "us_wv",
  wi: "us_wi",
  wy: "us_wy",
};

export function mapExhibitJurisdictionToOpenCorporates(exhibitJurisdiction: string | null | undefined): JurisdictionMapOutcome {
  const t = normalizeJurisdictionKey(exhibitJurisdiction ?? "");
  if (!t) return { kind: "unmapped", reason: "empty" };

  for (const variant of expandJurisdictionVariants(t)) {
    if (OPENCORPORATES_JURISDICTION_MAP[variant]) {
      return { kind: "mapped", ocCode: OPENCORPORATES_JURISDICTION_MAP[variant] };
    }
    if (/^[a-z]{2}$/.test(variant) && US_STATE_ABBR_TO_OC[variant]) {
      return { kind: "mapped", ocCode: US_STATE_ABBR_TO_OC[variant] };
    }
    const fromPrefix = matchLeadingUsStateCode(variant);
    if (fromPrefix) {
      return { kind: "mapped", ocCode: fromPrefix };
    }
  }

  const firstTok = t.split(/[\s,]+/)[0] ?? "";
  if (/^[a-z]{2}$/.test(firstTok) && US_STATE_ABBR_TO_OC[firstTok]) {
    return { kind: "mapped", ocCode: US_STATE_ABBR_TO_OC[firstTok] };
  }

  return { kind: "unmapped", reason: "unknown_label" };
}
