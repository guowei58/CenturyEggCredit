/**
 * Best-effort public-records profile hints from SEC submissions + latest 10-K HTML.
 * Does not replace manual diligence — borrowers/guarantors usually need credit documents.
 */

import { getSubsidiaryHintsForTicker } from "@/lib/subsidiary-hints";
import { getCompanyProfile, getSecEdgarUserAgent } from "@/lib/sec-edgar";
import { resolveLatest10KFiling } from "@/lib/sec-10k";

import type { PublicRecordsSecPrefill } from "@/lib/publicRecordsSecPrefillTypes";

const US_STATE_NAMES: Record<string, string> = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

function normalizeWhitespace(s: string): string {
  return s
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

/** Minimal SEC HTML → text (aligned with sec-10k.ts). */
function stripSecFilingHtml(html: string): string {
  const noScript = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");
  const withBreaks = noScript
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<\/tr>/gi, "\n")
    .replace(/<\/li>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, " ");
  return normalizeWhitespace(decodeHtmlEntities(text));
}

function normalizeStateCode(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t || t === "—" || t === "-") return null;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const full = US_STATE_NAMES[t.toLowerCase()];
  return full ?? null;
}

function findItem2Slice(text: string): string | null {
  const idx = text.search(/\bITEM\s+2\.?\s*[\s\S]{0,40}\bPROPERT/i);
  if (idx < 0) return null;
  const after = text.slice(idx);
  const end = after.search(/\bITEM\s+3\b/i);
  const slice = end > 0 ? after.slice(0, end) : after.slice(0, 14_000);
  return slice;
}

/**
 * Pull a registrant HQ / principal executive block from plain filing text.
 */
function extractPrincipalExecutiveOffice(text: string): { address: string | null; snippetSource: string | null } {
  const head = text.slice(0, 45_000);
  const item2 = findItem2Slice(text);
  const windows = [head, item2 ?? ""].filter((w) => w.length > 80);

  const tryPatterns = (window: string): string | null => {
    const patterns: RegExp[] = [
      /principal\s+executive\s+offices?\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([\s\S]{15,900}?)(?=\n\s*\n\s*(?:ITEM\s+\d|Item\s+\d|PART\s+[IVX\d]|NOTE\s+\d|\(\s*[a-z]\s*\)\s*$))/i,
      /principal\s+executive\s+office\s+is\s+(?:located\s+)?(?:at|in)\s+([\s\S]{15,900}?)(?=\n\s*\n\s*(?:ITEM\s+\d|Item\s+\d|PART\s+[IVX\d]))/i,
      /principal\s+executive\s+offices?\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
      /principal\s+executive\s+office\s+is\s+(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
      /corporate\s+headquarters\s+(?:are\s+)?(?:located\s+)?(?:at|in)\s+([^\n]{15,400})/i,
    ];
    for (const re of patterns) {
      const m = window.match(re);
      if (m?.[1]) {
        const cleaned = normalizeWhitespace(m[1]).replace(/\s+$/g, "");
        if (cleaned.length >= 12 && cleaned.length <= 950) return cleaned;
      }
    }
    return null;
  };

  for (const w of windows) {
    const hit = tryPatterns(w);
    if (hit) return { address: hit, snippetSource: w === head ? "10-K header / Item 1 region" : "Item 2 (Properties)" };
  }
  return { address: null, snippetSource: null };
}

/** Parse trailing "City, ST ZIP" from a US-style address block. */
function parseCityStateFromAddress(block: string): { city: string | null; state: string | null } {
  const lines = block.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const tail = lines.slice(-3).join("\n");
  const oneLine = tail.replace(/\n/g, ", ");
  const z = oneLine.match(/,\s*([^,]+?),\s*([A-Z]{2})\s+\d{5}(?:-\d{4})?\s*$/i);
  if (z) {
    return { city: z[1].replace(/^[\d\s]+/, "").trim(), state: z[2].toUpperCase() };
  }
  const z2 = oneLine.match(/,\s*([^,]+?),\s*([A-Z]{2})\s*$/i);
  if (z2) {
    return { city: z2[1].trim(), state: z2[2].toUpperCase() };
  }
  const z3 = block.match(/\b([A-Za-z][a-z]+(?:\s+[A-Za-z][a-z]+)?),\s*([A-Z]{2})\s+\d{5}\b/);
  if (z3) return { city: z3[1].trim(), state: z3[2].toUpperCase() };
  return { city: null, state: null };
}

function distinctMerge(base: string[], extra: string[], excludeLower: Set<string>): string[] {
  const out = [...base];
  const seen = new Set(out.map((x) => x.toLowerCase()));
  for (const x of excludeLower) seen.add(x);
  for (const e of extra) {
    const t = e.replace(/\s+/g, " ").trim();
    if (t.length < 2) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export async function buildPublicRecordsProfileFromSec(
  ticker: string,
  userId: string | null | undefined
): Promise<{ ok: true; prefill: PublicRecordsSecPrefill } | { ok: false; message: string }> {
  const tk = ticker.trim().toUpperCase();
  if (!tk) return { ok: false, message: "Ticker required" };

  const sources: string[] = [];
  const warnings: string[] = [
    "Borrowers, guarantors, DBAs, and operating-company roles are usually not fully disclosed in the 10-K alone — supplement from credit agreements, indentures, and org charts.",
    "HQ county is not inferred automatically from SEC text; confirm against maps or assessor records.",
  ];

  const secProfile = await getCompanyProfile(tk);
  if (!secProfile) {
    return { ok: false, message: "Could not load SEC company profile (ticker → CIK). Check the symbol or try again." };
  }

  sources.push(`SEC submissions JSON — registrant name, state of incorporation, former names (${tk})`);

  const companyName = secProfile.name.replace(/\s+/g, " ").trim() || null;
  const stateOfIncorporation = normalizeStateCode(secProfile.stateOfIncorporation);
  if (!stateOfIncorporation && secProfile.stateOfIncorporation && secProfile.stateOfIncorporation !== "—") {
    warnings.push(`State of incorporation from SEC (“${secProfile.stateOfIncorporation}”) could not be normalized to a 2-letter code — verify manually.`);
  }

  const formerNames = secProfile.formerNames ?? [];
  const legalNames = companyName ? [companyName] : [];
  const issuerNames = companyName ? [companyName] : [];

  let subsidiaryNames: string[] = [];
  const hints = await getSubsidiaryHintsForTicker(tk, userId);
  if (hints.ok) {
    sources.push(...hints.sources);
    const parentLower = (companyName ?? tk).toLowerCase();
    const exclude = new Set([parentLower]);
    subsidiaryNames = hints.names.filter((n) => n.toLowerCase() !== parentLower);
    subsidiaryNames = distinctMerge([], subsidiaryNames, exclude);
  } else {
    warnings.push(hints.message);
  }

  let filing: PublicRecordsSecPrefill["filing"] = null;
  let principalExecutiveOfficeAddress: string | null = null;
  let hqCity: string | null = null;
  let hqState: string | null = null;

  const tenK = await resolveLatest10KFiling(tk);
  if (tenK?.docUrl) {
    try {
      const res = await fetch(tenK.docUrl, { headers: { "User-Agent": getSecEdgarUserAgent() } });
      if (res.ok) {
        const html = await res.text();
        const text = stripSecFilingHtml(html);
        const { address, snippetSource } = extractPrincipalExecutiveOffice(text);
        if (address) {
          principalExecutiveOfficeAddress = address;
          const geo = parseCityStateFromAddress(address);
          hqCity = geo.city;
          hqState = geo.state;
          sources.push(
            `Latest ${tenK.form} (${tenK.filingDate}) — principal executive / HQ text (${snippetSource ?? "pattern match"})`
          );
        } else {
          warnings.push("Could not find a principal executive office paragraph in the latest 10-K text — paste from the cover page or Item 2 manually.");
        }
        filing = { form: tenK.form, filingDate: tenK.filingDate, docUrl: tenK.docUrl };
      }
    } catch {
      warnings.push("Failed to download the latest 10-K for address extraction.");
    }
  } else {
    warnings.push("No annual Form 10-K found in SEC submissions (recent window + full filing index). Foreign issuers may file 20-F instead of 10-K.");
  }

  const prefill: PublicRecordsSecPrefill = {
    companyName,
    legalNames,
    formerNames,
    subsidiaryNames,
    issuerNames,
    stateOfIncorporation,
    hqState,
    hqCity,
    hqCounty: null,
    principalExecutiveOfficeAddress,
    sources: Array.from(new Set(sources)),
    warnings,
    filing,
  };

  return { ok: true, prefill };
}
