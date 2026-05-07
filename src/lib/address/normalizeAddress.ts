const SUFFIXES: Array<[RegExp, string]> = [
  [/\bSTREET\b/g, "ST"],
  [/\bST\b\.?/g, "ST"],
  [/\bAVENUE\b/g, "AVE"],
  [/\bAVE\b\.?/g, "AVE"],
  [/\bROAD\b/g, "RD"],
  [/\bRD\b\.?/g, "RD"],
  [/\bDRIVE\b/g, "DR"],
  [/\bDR\b\.?/g, "DR"],
  [/\bBOULEVARD\b/g, "BLVD"],
  [/\bBLVD\b\.?/g, "BLVD"],
  [/\bLANE\b/g, "LN"],
  [/\bLN\b\.?/g, "LN"],
  [/\bCOURT\b/g, "CT"],
  [/\bCT\b\.?/g, "CT"],
  [/\bPARKWAY\b/g, "PKWY"],
  [/\bPKWY\b\.?/g, "PKWY"],
  [/\bHIGHWAY\b/g, "HWY"],
  [/\bHWY\b\.?/g, "HWY"],
];

const UNIT_WORDS: Array<[RegExp, string]> = [
  [/\bSUITE\b/g, "STE"],
  [/\bSTE\b\.?/g, "STE"],
  [/\bFLOOR\b/g, "FL"],
  [/\bFL\b\.?/g, "FL"],
  [/\bBUILDING\b/g, "BLDG"],
  [/\bBLDG\b\.?/g, "BLDG"],
  [/\bUNIT\b/g, "UNIT"],
];

const DIRECTIONS: Array<[RegExp, string]> = [
  [/\bNORTH\b/g, "N"],
  [/\bSOUTH\b/g, "S"],
  [/\bEAST\b/g, "E"],
  [/\bWEST\b/g, "W"],
];

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function stripPunct(s: string): string {
  return s.replace(/[.,;:#]/g, " ");
}

export type NormalizedAddress = {
  rawAddress: string;
  normalizedAddress: string;
  isPoBox: boolean;
  /** Heuristic — not authoritative. */
  isLikelyRegisteredAgent: boolean;
  streetNumber?: string | null;
  streetName?: string | null;
  unit?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  postalCodePlus4?: string | null;
};

const RA_HINTS = [
  "CT CORPORATION",
  "CORPORATION SERVICE COMPANY",
  "CSC",
  "REGISTERED AGENT",
  "NATIONAL REGISTERED AGENTS",
  "INCORP SERVICES",
];

function parseParts(normalized: string): {
  streetNumber: string | null;
  streetName: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  postalCodePlus4: string | null;
} {
  // Very lightweight US-oriented parsing; preserves auditability by never changing rawAddress.
  const mZip = normalized.match(/\b(\d{5})(?:-(\d{4}))?\b/);
  const postalCode = mZip ? mZip[1] : null;
  const postalCodePlus4 = mZip && mZip[2] ? mZip[2] : null;

  const mState = normalized.match(/\b([A-Z]{2})\b(?:\s+\d{5}(?:-\d{4})?)?\s*$/);
  const state = mState ? mState[1] : null;

  // Try to split "STREET..., CITY, ST 12345" (after punctuation stripped, commas may be gone; we treat last tokens).
  const tokens = normalized.split(" ").filter(Boolean);
  const stateIdx = state ? tokens.lastIndexOf(state) : -1;
  const city =
    stateIdx > 0
      ? tokens.slice(Math.max(0, stateIdx - 3), stateIdx).join(" ").trim() || null
      : null;

  // Street number: first token if numeric (or numeric+alpha).
  const streetNumber = tokens.length > 0 && /^[0-9]{1,6}[A-Z]?$/.test(tokens[0]) ? tokens[0] : null;

  // Unit heuristics.
  const unitMatch = normalized.match(/\b(STE|UNIT|FL|BLDG)\s+([A-Z0-9-]+)\b/);
  const unit = unitMatch ? `${unitMatch[1]} ${unitMatch[2]}` : null;

  const streetName =
    streetNumber
      ? squash(
          tokens
            .slice(
              1,
              stateIdx > 0 ? Math.max(1, stateIdx - 3) : Math.min(tokens.length, 6)
            )
            .join(" ")
        ) || null
      : null;

  return { streetNumber, streetName, unit, city, state, postalCode, postalCodePlus4 };
}

export function normalizeAddress(raw: string | null | undefined): NormalizedAddress {
  const rawAddress = String(raw ?? "");
  let s = rawAddress.trim();
  if (!s) return { rawAddress, normalizedAddress: "", isPoBox: false, isLikelyRegisteredAgent: false };

  s = stripPunct(s);
  s = s.toUpperCase();
  s = s.replace(/\bP\s*O\s*BOX\b/g, "PO BOX");
  s = s.replace(/\bP O\b/g, "PO");
  s = s.replace(/\bP\.?\s*O\.?\b/g, "PO");

  for (const [re, rep] of DIRECTIONS) s = s.replace(re, rep);
  for (const [re, rep] of SUFFIXES) s = s.replace(re, rep);
  for (const [re, rep] of UNIT_WORDS) s = s.replace(re, rep);

  s = squash(s);

  const isPoBox = /\bPO BOX\b/.test(s);
  const isLikelyRegisteredAgent = RA_HINTS.some((h) => s.includes(h));

  const parts = parseParts(s);
  return { rawAddress, normalizedAddress: s, isPoBox, isLikelyRegisteredAgent, ...parts };
}

