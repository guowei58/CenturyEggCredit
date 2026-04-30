/** Normalization for matching only — preserved originals stay elsewhere. */

const SUFFIX_CHAIN = [
  /\bINCORPORATED\b$/i,
  /\bINC\b\.?$/i,
  /\bCORPORATION\b$/i,
  /\bCORP\b\.?$/i,
  /\bCOMPANY\b$/i,
  /\bCO\b\.?$/i,
  /\bL\.?\s?L\.?\s?C\b\.?$/i,
  /\bLLC\b\.?$/i,
  /\bL\.?\s?P\b\.?$/i,
  /\bLP\b\.?$/i,
  /\bLTD\b\.?$/i,
  /\bLIMITED\b$/i,
  /\bPLC\b\.?$/i,
  /\bHOLDINGS\b$/i,
  /\bHOLDING\b$/i,
  /\bGROUP\b$/i,
] as const;

const GENERIC_REGISTERED_AGENTS = [
  /\bCT\s+CORPORATION\b/i,
  /\bC\s*T\s+CORPORATION\b/i,
  /\bCORPORATION\s+SERVICE\s+COMPANY\b/i,
  /\bCORPORATION\s+SERVICE\s+COMP\b/i,
  /\bCSC\b/i,
  /\bTHE\s+CORPORATION\s+TRUST\s+COMPANY\b/i,
  /\bCORPORATION\s+TRUST\s+COMPANY\b/i,
  /\bCOGENCY\s+GLOBAL\b/i,
  /\bCOGENCY\b/i,
  /\bNATIONAL\s+REGISTERED\s+AGENTS\b/i,
  /\bREGISTERED\s+AGENT\s+SOLUTIONS\b/i,
  /\bINCORP\s+SERVICES\b/i,
  /\bINCORP\s+SERVICE\b/i,
  /\bNORTHWEST\s+REGISTERED\s+AGENT\b/i,
  /\bLEGALZOOM\b/i,
  /\bHARVARD\s+BUSINESS\s+SERVICES\b/i,
  /\bUNITED\s+AGENT\s+GROUP\b/i,
  /\bCAPITOL\s+SERVICES\b/i,
  /\bLEGALINC\b/i,
] as const;

export type NormalizedName = {
  /** Original trimmed input */
  original: string;
  /** Uppercase stripped punctuation-heavy key */
  normalized: string;
  /** Without trailing corporate suffix (for fuzzy matching) */
  root: string;
};

export function normalizeEntityName(name: string): NormalizedName {
  const original = name.trim();
  let step = original.toUpperCase();
  step = step.replace(/\s+/g, " ");
  step = step.replace(/\bAND\b/g, "&").replace(/\s*&\s*/g, " AND ");
  step = step.replace(/[^A-Z0-9\s&']/g, " ");
  step = step.replace(/\s+/g, " ").trim();

  let root = step;
  for (let guard = 0; guard < 12; guard++) {
    let changed = false;
    for (const re of SUFFIX_CHAIN) {
      const next = root.replace(re, "").replace(/\s+/g, " ").trim();
      if (next !== root) {
        root = next;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return { original: name.trim(), normalized: step, root: root || step };
}

export function removeEntitySuffix(name: string): string {
  return normalizeEntityName(name).root;
}

const SAFE_ABBREV: [RegExp, string][] = [
  [/\bSTREET\b/gi, "ST"],
  [/\bST\.\s*$/gi, "ST"],
  [/\bAVENUE\b/gi, "AVE"],
  [/\bROAD\b/gi, "RD"],
  [/\bDRIVE\b/gi, "DR"],
  [/\bBOULEVARD\b/gi, "BLVD"],
  [/\bSUITE\b/gi, "STE"],
  [/\bFLOOR\b/gi, "FL"],
  [/\bAPARTMENT\b/gi, "APT"],
  [/,\s*/g, ", "],
];

export type NormalizedAddress = { original: string; normalized: string };

export function normalizeAddress(address: string): NormalizedAddress {
  const original = address.trim();
  let step = original.toUpperCase();
  step = step.replace(/\s+/g, " ");
  for (const [re, rep] of SAFE_ABBREV) {
    step = step.replace(re, rep);
  }
  step = step.replace(/[^A-Z0-9\s#,.\-']/g, " ");
  step = step.replace(/\s+/g, " ").trim();
  return { original: address.trim(), normalized: step };
}

export function isGenericRegisteredAgent(name: string | null | undefined, extraPatterns: RegExp[] = []): boolean {
  if (!name?.trim()) return false;
  const n = name.toUpperCase().trim();
  for (const re of GENERIC_REGISTERED_AGENTS) {
    if (re.test(n)) return true;
  }
  for (const re of extraPatterns) {
    if (re.test(n)) return true;
  }
  return false;
}
