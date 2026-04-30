/**
 * US county resolution via Census Bureau Geocoder (free, no API key).
 * Fallback: Zippopotam place + state from ZIP, then geocode "City, ST ZIP".
 */

const CENSUS_GEOGRAPHIES_ONE_LINE =
  "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress";
const ZIPPO_BASE = "https://api.zippopotam.us/us";

function timeoutSignal(ms: number): AbortSignal {
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

/** Counties[0].BASENAME or NAME without a redundant "County" suffix for display. */
function countyLabelFromCensus(c: { BASENAME?: string; NAME?: string } | undefined): string | null {
  if (!c) return null;
  const raw = (c.BASENAME ?? c.NAME ?? "").trim();
  if (!raw) return null;
  return raw.replace(/\s+County$/i, "").trim() || null;
}

/**
 * Returns county display name (e.g. "Morris") from a US postal-style one-line address.
 */
export async function lookupCountyNameFromUsAddressLine(oneLine: string): Promise<string | null> {
  const trimmed = oneLine.replace(/\s+/g, " ").trim();
  if (trimmed.length < 8) return null;
  const url = new URL(CENSUS_GEOGRAPHIES_ONE_LINE);
  url.searchParams.set("address", trimmed);
  url.searchParams.set("benchmark", "4");
  url.searchParams.set("vintage", "4");
  url.searchParams.set("format", "json");
  try {
    const res = await fetch(url.toString(), { signal: timeoutSignal(18_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      result?: { addressMatches?: Array<{ geographies?: { Counties?: Array<{ BASENAME?: string; NAME?: string }> } }> };
    };
    const counties = data.result?.addressMatches?.[0]?.geographies?.Counties;
    return countyLabelFromCensus(counties?.[0]);
  } catch {
    return null;
  }
}

type ZippoPlace = { placeName: string; stateAbbr: string };

async function zippoFirstPlace(zip5: string): Promise<ZippoPlace | null> {
  const z = zip5.replace(/\D/g, "").slice(0, 5);
  if (z.length !== 5) return null;
  try {
    const res = await fetch(`${ZIPPO_BASE}/${encodeURIComponent(z)}`, { signal: timeoutSignal(12_000) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      places?: Array<{ "place name"?: string; "state abbreviation"?: string }>;
    };
    const p = data.places?.[0];
    const placeName = p?.["place name"]?.trim();
    const stateAbbr = p?.["state abbreviation"]?.trim().toUpperCase();
    if (!placeName || !stateAbbr || stateAbbr.length !== 2) return null;
    return { placeName, stateAbbr };
  } catch {
    return null;
  }
}

/**
 * Best-effort county from ZIP only (Zippopotam → synthetic "City, ST ZIP" → Census).
 */
export async function lookupCountyNameFromUsZip(zipRaw: string): Promise<string | null> {
  const z = zipRaw.replace(/\D/g, "").slice(0, 5);
  if (z.length !== 5) return null;
  const place = await zippoFirstPlace(z);
  if (!place) return null;
  const line = `${place.placeName}, ${place.stateAbbr} ${z}`;
  return lookupCountyNameFromUsAddressLine(line);
}

/** When city/state lines are messy, infer 2-letter state from USPS ZIP (Zippopotam). */
export async function lookupStateAbbrFromUsZip(zipRaw: string): Promise<string | null> {
  const z = zipRaw.replace(/\D/g, "").slice(0, 5);
  if (z.length !== 5) return null;
  return (await zippoFirstPlace(z))?.stateAbbr ?? null;
}
