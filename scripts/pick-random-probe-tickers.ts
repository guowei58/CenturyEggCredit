/**
 * Stratified random ticker pick (mega → small) for 10-Q probes.
 * Usage: npx tsx scripts/pick-random-probe-tickers.ts [COUNT] [SEED]
 */
const TIERS: Record<string, string[]> = {
  mega: [
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "BRK.B", "JPM", "WMT", "XOM", "JNJ", "V", "UNH", "PG", "HD",
  ],
  large: [
    "KO", "PEP", "COST", "MRK", "ABBV", "TMO", "AVGO", "MCD", "CSCO", "ACN", "WFC", "ORCL", "IBM", "GE", "CAT",
    "BA", "DIS", "NKE", "LOW", "RTX", "HON", "QCOM", "SPGI", "INTC", "AMD", "PFE", "INTU", "AMGN", "TXN", "PM",
  ],
  mid: [
    "MANH", "HUBB", "DECK", "DUOL", "PCTY", "PEGA", "SON", "TER", "BURL", "SRPT", "RGEN", "GNRC", "ITT", "MIDD",
    "AIT", "BELFB", "BIO", "IONS", "ATMU", "NXST", "CHTR", "FICO", "HAS", "SAIA", "ITW", "EMR", "ETN", "PH", "ROP",
    "TDY", "ZBRA", "POOL", "WWD", "UFPI", "WSC", "DOV", "ROK", "IEX", "AIT", "GNTX",
  ],
  small: [
    "CABO", "OPTU", "BHC", "BLCO", "MAGN", "GEN", "MODG", "CALX", "SPSC", "OSIS", "PRGS", "PDFS", "ATEN", "CEVA",
    "ZD", "VRA", "CRI", "GIII", "SCVL", "SHOO", "MGPI", "LKFN", "NPK", "MGRC", "TRNS",
  ],
};

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function pickTier(tier: string[], n: number, rand: () => number): string[] {
  const uniq = [...new Set(tier)];
  return shuffle(uniq, rand).slice(0, Math.min(n, uniq.length));
}

const count = Math.max(1, parseInt(process.argv[2] ?? "50", 10));
const seed = parseInt(process.argv[3] ?? "20260521", 10);
const focus = (process.argv[4] ?? "").toLowerCase();
const rand = mulberry32(seed);

const quotas =
  focus === "small"
    ? { mega: 0, large: 0, mid: Math.round(count * 0.55), small: count - Math.round(count * 0.55) }
    : {
        mega: Math.round(count * 0.3),
        large: Math.round(count * 0.3),
        mid: Math.round(count * 0.25),
        small: count - Math.round(count * 0.3) - Math.round(count * 0.3) - Math.round(count * 0.25),
      };

let picked = [
  ...pickTier(TIERS.mega, quotas.mega, rand),
  ...pickTier(TIERS.large, quotas.large, rand),
  ...pickTier(TIERS.mid, quotas.mid, rand),
  ...pickTier(TIERS.small, quotas.small, rand),
];

picked = [...new Set(picked)];
const pool = shuffle(
  [...new Set([...TIERS.mega, ...TIERS.large, ...TIERS.mid, ...TIERS.small])].filter((t) => !picked.includes(t)),
  rand
);
while (picked.length < count && pool.length > 0) picked.push(pool.pop()!);
picked = picked.slice(0, count);

console.log(picked.join(","));
