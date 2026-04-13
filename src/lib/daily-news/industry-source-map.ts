/**
 * Per-ticker trade publications: scored from SEC SIC, SIC description, and company name.
 * Google News `site:` search is used when RSS is omitted.
 * Edit this file to extend coverage — do not embed in UI components.
 */

import { expandSicContext } from "./sic-semantic-tags";

export type TradePublication = {
  id: string;
  name: string;
  /** Direct RSS if known and stable; otherwise omitted and search is used */
  rssUrl?: string;
  /** Used with Google News: site:domain */
  siteDomain: string;
};

/** Scoring metadata — not stored on payload */
type ScoredPublication = TradePublication & {
  /** +8 when SIC (normalized) starts with any prefix */
  sicPrefixes?: string[];
  /** Weighted substring hits in normalized context (name, SIC, semantic tags, former names) */
  keywords: string[];
  /** Large boost when watchlist ticker matches (e.g. known pure-play symbols) */
  tickers?: string[];
  /** +12 when company name contains any of these substrings (lowercase) */
  companyNameHints?: string[];
};

function normalizeSic(sic: string): string {
  return sic.replace(/\D/g, "").slice(0, 4);
}

function buildContext(
  ticker: string,
  companyName: string,
  sicRaw: string,
  sicDescription: string,
  formerNames?: string[]
): string {
  const sicNorm = normalizeSic(sicRaw);
  const semantic = expandSicContext(sicNorm);
  const former = (formerNames ?? [])
    .filter(Boolean)
    .slice(0, 8)
    .join(" ");
  const parts = [
    ticker,
    companyName,
    sicRaw,
    sicDescription,
    sicNorm,
    semantic,
    former,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return parts.replace(/\s+/g, " ").trim();
}

/** Longer phrase matches count more — reduces noisy short-token collisions. */
function keywordMatchWeight(keywordLen: number): number {
  if (keywordLen < 4) return 1;
  if (keywordLen < 9) return 2;
  if (keywordLen < 16) return 3;
  return 5;
}

const MAX_KEYWORD_POINTS_PER_PUB = 16;

type PubScoreDetail = { score: number; longestKeywordMatch: number };

function scorePublicationDetails(
  pub: ScoredPublication,
  ctx: string,
  sic: string,
  ticker: string,
  companyName: string
): PubScoreDetail {
  let score = 0;
  let longestKeywordMatch = 0;
  const tk = ticker.trim().toUpperCase();
  if (pub.tickers?.length && pub.tickers.some((t) => t.toUpperCase() === tk)) {
    score += 42;
  }
  const nameLow = (companyName || "").toLowerCase();
  if (pub.companyNameHints?.length && pub.companyNameHints.some((h) => h.length >= 2 && nameLow.includes(h))) {
    score += 12;
  }
  if (pub.sicPrefixes?.length && pub.sicPrefixes.some((p) => sic.startsWith(p))) {
    score += 8;
  }
  let kwPoints = 0;
  for (const kw of pub.keywords) {
    if (kw.length >= 2 && ctx.includes(kw)) {
      longestKeywordMatch = Math.max(longestKeywordMatch, kw.length);
      kwPoints += keywordMatchWeight(kw.length);
    }
  }
  score += Math.min(kwPoints, MAX_KEYWORD_POINTS_PER_PUB);
  return { score, longestKeywordMatch };
}

/** FNV-1a — stable per ticker for rotating generic sources */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Broad trade sites used only to fill missing slots or when no keyword/SIC match fires.
 * Order matters for rotation — keep domains distinct.
 */
const GENERAL_POOL: TradePublication[] = [
  { id: "industry-week", name: "IndustryWeek", siteDomain: "industryweek.com" },
  { id: "supply-chain-dive", name: "Supply Chain Dive", siteDomain: "supplychaindive.com" },
  { id: "manufacturing-net", name: "Manufacturing.net", siteDomain: "manufacturing.net" },
  { id: "food-dive", name: "Food Dive", siteDomain: "fooddive.com" },
  { id: "construction-dive", name: "Construction Dive", siteDomain: "constructiondive.com" },
  { id: "freightwaves", name: "FreightWaves", siteDomain: "freightwaves.com" },
  { id: "assembly-magazine", name: "Assembly Magazine", siteDomain: "assemblymag.com" },
  { id: "the-manufacturer", name: "The Manufacturer", siteDomain: "themanufacturer.com" },
  { id: "thomasnet-insights", name: "Thomas Insights", siteDomain: "thomasnet.com" },
  { id: "plant-services", name: "Plant Services", siteDomain: "plantservices.com" },
  { id: "automation-world", name: "Automation World", siteDomain: "automationworld.com" },
  { id: "quality-magazine", name: "Quality Magazine", siteDomain: "qualitymagazine.com" },
];

function fillFromGeneralPool(ticker: string, excludeDomains: Set<string>): TradePublication[] {
  const n = GENERAL_POOL.length;
  if (n === 0) return [];
  const start = hashString(ticker) % n;
  const out: TradePublication[] = [];
  for (let i = 0; i < n && out.length < 3; i++) {
    const p = GENERAL_POOL[(start + i) % n]!;
    if (!excludeDomains.has(p.siteDomain)) {
      excludeDomains.add(p.siteDomain);
      out.push({ id: p.id, name: p.name, siteDomain: p.siteDomain });
    }
  }
  return out;
}

function toPayload(p: ScoredPublication): TradePublication {
  const { keywords: _k, sicPrefixes: _s, tickers: _t, companyNameHints: _h, ...rest } = p;
  return rest;
}

/**
 * Keyword / SIC-tagged trade publications. Add rows here before adding new verticals in UI.
 */
const TRADE_CATALOG: ScoredPublication[] = [
  // Telecom / connectivity
  {
    id: "fierce-network",
    name: "Fierce Network",
    siteDomain: "fierce-network.com",
    sicPrefixes: ["48"],
    keywords: ["telecom", "telephone", "wireless", "cellular", "5g", "broadband", "fiber", "cable tv", "cable communication"],
  },
  {
    id: "light-reading",
    name: "Light Reading",
    siteDomain: "lightreading.com",
    keywords: ["telecom", "network equipment", "optical", "broadband"],
  },
  {
    id: "telecom-ramblings",
    name: "Telecom Ramblings",
    siteDomain: "telecomramblings.com",
    keywords: ["telecom", "data center", "fiber", "tower"],
  },
  // Media / ads / entertainment
  {
    id: "ad-age",
    name: "Ad Age",
    siteDomain: "adage.com",
    keywords: ["advertising", "marketing", "media", "broadcasting", "publishing", "entertainment", "cable networks"],
  },
  {
    id: "digiday",
    name: "Digiday",
    siteDomain: "digiday.com",
    keywords: ["advertising", "digital media", "marketing", "publish"],
  },
  {
    id: "variety",
    name: "Variety",
    siteDomain: "variety.com",
    keywords: ["motion picture", "film", "television", "studio", "entertainment"],
  },
  // Retail / consumer
  {
    id: "retail-dive",
    name: "Retail Dive",
    siteDomain: "retaildive.com",
    sicPrefixes: ["52", "53", "54", "56", "57", "59"],
    keywords: ["retail", "department store", "grocery", "apparel", "merchandise", "restaurant"],
  },
  {
    id: "chain-store-age",
    name: "Chain Store Age",
    siteDomain: "chainstoreage.com",
    keywords: ["retail", "stores", "supermarket", "discount"],
  },
  {
    id: "modern-retail",
    name: "Modern Retail",
    siteDomain: "modernretail.co",
    keywords: ["e-commerce", "ecommerce", "direct-to-consumer", "d2c", "retail"],
  },
  {
    id: "nrn",
    name: "Nation's Restaurant News",
    siteDomain: "nrn.com",
    keywords: ["restaurant", "food service", "dining"],
  },
  // Travel / hospitality / airlines
  {
    id: "skift",
    name: "Skift",
    siteDomain: "skift.com",
    keywords: ["airline", "air transportation", "hotel", "lodging", "travel", "casino", "resort", "cruise"],
  },
  {
    id: "phocuswire",
    name: "PhocusWire",
    siteDomain: "phocuswire.com",
    keywords: ["travel", "hospitality", "booking", "ota"],
  },
  // Banks / markets / insurance
  {
    id: "american-banker",
    name: "American Banker",
    siteDomain: "americanbanker.com",
    sicPrefixes: ["60", "61", "62"],
    keywords: ["bank", "banking", "savings institution", "credit union", "mortgage", "consumer finance"],
  },
  {
    id: "finextra",
    name: "Finextra",
    siteDomain: "finextra.com",
    keywords: ["financial", "payments", "fintech", "banking"],
  },
  {
    id: "risk-net",
    name: "Risk.net",
    siteDomain: "risk.net",
    keywords: ["capital market", "securities", "broker", "dealer", "derivative", "trading"],
  },
  {
    id: "insurance-journal",
    name: "Insurance Journal",
    siteDomain: "insurancejournal.com",
    sicPrefixes: ["63", "64"],
    keywords: ["insurance", "underwriting", "reinsurance"],
  },
  {
    id: "housing-wire",
    name: "HousingWire",
    siteDomain: "housingwire.com",
    keywords: ["mortgage", "mortgage bankers", "real estate credit"],
  },
  // REITs / property (67xx)
  {
    id: "globest",
    name: "GlobeSt",
    siteDomain: "globest.com",
    sicPrefixes: ["65", "67"],
    keywords: ["reit", "real estate investment", "lessors", "office building", "shopping center"],
  },
  {
    id: "commercial-observer",
    name: "Commercial Observer",
    siteDomain: "commercialobserver.com",
    keywords: ["commercial real", "property", "landlord", "office building"],
  },
  // Healthcare — sub-verticals
  {
    id: "fierce-pharma",
    name: "Fierce Pharma",
    siteDomain: "fiercepharma.com",
    keywords: ["pharmaceutical", "drug", "medicinal", "biologic", "vaccine"],
  },
  {
    id: "stat-news",
    name: "STAT",
    siteDomain: "statnews.com",
    keywords: ["biotechnology", "biopharma", "clinical trial", "therapeutic"],
  },
  {
    id: "healthcare-dive",
    name: "Healthcare Dive",
    siteDomain: "healthcaredive.com",
    sicPrefixes: ["80"],
    keywords: ["hospital", "health services", "managed care", "healthcare", "physician"],
  },
  {
    id: "medcity-news",
    name: "MedCity News",
    siteDomain: "medcitynews.com",
    keywords: ["medical device", "health it", "digital health", "diagnostic"],
  },
  {
    id: "fierce-biotech",
    name: "Fierce Biotech",
    siteDomain: "fiercebiotech.com",
    keywords: ["biotechnology", "biotech", "genetic", "cell therapy"],
  },
  // Tech / software / semis
  {
    id: "crn",
    name: "CRN",
    siteDomain: "crn.com",
    keywords: ["computer", "software", "prepackaged software", "information technology", "systems"],
  },
  {
    id: "semiengineering",
    name: "Semiconductor Engineering",
    siteDomain: "semiengineering.com",
    sicPrefixes: ["36", "367"],
    keywords: ["semiconductor", "integrated circuit", "wafer", "foundry"],
  },
  {
    id: "eetimes",
    name: "EE Times",
    siteDomain: "eetimes.com",
    keywords: ["semiconductor", "electronics", "chip", "embedded"],
  },
  {
    id: "theregister",
    name: "The Register",
    siteDomain: "theregister.com",
    keywords: ["software", "computer programming", "data processing", "cloud", "saas"],
  },
  {
    id: "techcrunch",
    name: "TechCrunch",
    siteDomain: "techcrunch.com",
    keywords: ["internet", "social network", "platform", "technology"],
  },
  // Vehicle rental / fleet (SIC 751x — avoid bare "car" keywords that match ticker CAR)
  {
    id: "auto-rental-news",
    name: "Auto Rental News",
    siteDomain: "autorentalnews.com",
    sicPrefixes: ["751"],
    tickers: ["HTZ", "CAR"],
    companyNameHints: ["hertz", "avis", "budget group", "dollar thrifty", "zipcar"],
    keywords: [
      "passenger car rental",
      "passenger car leasing",
      "passenger car rent",
      "automobile rental",
      "car rental",
      "vehicle rental",
      "auto rental",
      "rent-a-car",
      "rent a car",
      "truck rental",
      "utility trailer rental",
    ],
  },
  {
    id: "automotive-fleet",
    name: "Automotive Fleet",
    siteDomain: "automotive-fleet.com",
    sicPrefixes: ["751"],
    tickers: ["HTZ", "CAR"],
    companyNameHints: ["hertz", "avis", "budget group"],
    keywords: [
      "passenger car rental",
      "vehicle rental",
      "rental fleet",
      "fleet leasing",
      "car and truck",
      "commercial fleet",
      "fleet management",
      "fleet acquisition",
    ],
  },
  {
    id: "vehicle-remarketing",
    name: "Vehicle Remarketing",
    siteDomain: "vehicleremarket.com",
    sicPrefixes: ["751"],
    tickers: ["HTZ", "CAR"],
    companyNameHints: ["hertz", "avis", "budget group"],
    keywords: [
      "passenger car rental",
      "vehicle rental",
      "rental fleet",
      "remarketing",
      "de-fleet",
      "defleet",
      "fleet disposal",
      "residual value",
      "wholesale used vehicle",
    ],
  },
  // Automotive
  {
    id: "autonews",
    name: "Automotive News",
    siteDomain: "autonews.com",
    sicPrefixes: ["37"],
    keywords: ["motor vehicle", "automotive", "auto parts", "oem", "automobile manufacturing"],
  },
  {
    id: "green-car-reports",
    name: "Green Car Reports",
    siteDomain: "greencarreports.com",
    keywords: ["electric vehicle", "hybrid", "automotive", "battery vehicle"],
  },
  // Aerospace / defense
  {
    id: "defense-news",
    name: "Defense News",
    siteDomain: "defensenews.com",
    sicPrefixes: ["37"],
    keywords: ["aircraft", "aerospace", "defense", "military", "weapon"],
  },
  {
    id: "aviation-week",
    name: "Aviation Week",
    siteDomain: "aviationweek.com",
    keywords: ["aircraft", "aerospace", "aviation", "airline"],
  },
  // Energy / materials / mining
  {
    id: "oil-gas-journal",
    name: "Oil & Gas Journal",
    siteDomain: "ogj.com",
    sicPrefixes: ["13", "29"],
    keywords: ["petroleum", "oil", "gas", "drilling", "pipeline", "refining"],
  },
  {
    id: "mining-com",
    name: "Mining.com",
    siteDomain: "mining.com",
    sicPrefixes: ["10", "12", "14"],
    keywords: ["mining", "metal", "mineral", "gold", "copper"],
  },
  {
    id: "utility-dive",
    name: "Utility Dive",
    siteDomain: "utilitydive.com",
    sicPrefixes: ["49"],
    keywords: ["electric utility", "gas utility", "power generation", "utility"],
  },
  {
    id: "powermag",
    name: "POWER magazine",
    siteDomain: "powermag.com",
    keywords: ["power plant", "generation", "turbine", "utility"],
  },
  // Agriculture / chemicals
  {
    id: "agweb",
    name: "AgWeb",
    siteDomain: "agweb.com",
    sicPrefixes: ["01", "02", "07", "08", "09"],
    keywords: ["agriculture", "crop", "farm", "fertilizer", "seed"],
  },
  {
    id: "icis",
    name: "ICIS",
    siteDomain: "icis.com",
    sicPrefixes: ["28", "29", "30"],
    keywords: ["chemical", "petrochemical", "plastic", "specialty chemical"],
  },
  // Construction / engineering
  {
    id: "enr",
    name: "ENR",
    siteDomain: "enr.com",
    sicPrefixes: ["15", "16", "17"],
    keywords: ["construction", "engineering", "contractor", "heavy construction"],
  },
  {
    id: "construction-dive-pub",
    name: "Construction Dive",
    siteDomain: "constructiondive.com",
    keywords: ["construction", "builder", "infrastructure"],
  },
  // Logistics
  {
    id: "supply-chain-dive-pub",
    name: "Supply Chain Dive",
    siteDomain: "supplychaindive.com",
    keywords: ["logistics", "freight", "trucking", "warehouse", "shipping"],
  },
];

export type IndustryBucket = {
  id: string;
  label: string;
  sicPrefixes?: string[];
  descriptionKeywords?: string[];
  trades: TradePublication[];
};

/** For debugging / admin — full publication list */
export function listIndustryBuckets(): IndustryBucket[] {
  return [{ id: "scored-catalog", label: "Scored trade catalog", trades: TRADE_CATALOG.map(toPayload) }];
}

/**
 * Returns exactly three trade publications tailored to the ticker + company text + SEC industry fields.
 */
export function resolveTradePublications(
  ticker: string,
  companyName: string,
  sicRaw: string,
  sicDescription: string,
  formerNames?: string[]
): TradePublication[] {
  const sic = normalizeSic(sicRaw);
  const ctx = buildContext(ticker, companyName, sicRaw, sicDescription, formerNames);

  const ranked = TRADE_CATALOG.map((pub) => {
    const detail = scorePublicationDetails(pub, ctx, sic, ticker, companyName);
    return { pub, ...detail };
  })
    .filter((x) => x.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.longestKeywordMatch - a.longestKeywordMatch ||
        a.pub.id.localeCompare(b.pub.id)
    );

  const picked: TradePublication[] = [];
  const seen = new Set<string>();
  for (const { pub } of ranked) {
    if (picked.length >= 3) break;
    if (seen.has(pub.siteDomain)) continue;
    seen.add(pub.siteDomain);
    picked.push(toPayload(pub));
  }

  if (picked.length < 3) {
    const exclude = new Set(seen);
    const filler = fillFromGeneralPool(ticker, exclude);
    for (const p of filler) {
      if (picked.length >= 3) break;
      picked.push(p);
    }
  }

  return picked.slice(0, 3);
}
