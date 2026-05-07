import { mapExhibitJurisdictionToOpenCorporates } from "@/config/opencorporatesJurisdictionMap";

const US_STATE_FULL_TO_ABBR: Record<string, string> = {
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

/** Returns 2-letter USPS code when input looks US-state-ish; otherwise null. */
export function usStateAbbrFromText(input: string | null | undefined): string | null {
  const raw = (input ?? "").trim();
  if (!raw) return null;
  const t = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(t)) return t;
  const cleaned = raw.trim().toLowerCase().replace(/\.$/, "");
  const direct = US_STATE_FULL_TO_ABBR[cleaned];
  if (direct) return direct;
  // Handle "State: Louisiana" / "Louisiana (US)" / etc.
  const justLetters = cleaned.replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  const fromNoiseStripped = US_STATE_FULL_TO_ABBR[justLetters];
  if (fromNoiseStripped) return fromNoiseStripped;

  /** Exhibit 21 domicile prose, e.g. "Delaware limited liability company", "CO LLC". */
  const oc = mapExhibitJurisdictionToOpenCorporates(raw);
  if (oc.kind === "mapped") {
    const m = /^us_([a-z]{2})$/i.exec(oc.ocCode);
    if (m) return m[1]!.toUpperCase();
  }
  return null;
}

