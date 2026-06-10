/**
 * Pick random tickers excluding prior probe runs.
 * Usage: npx tsx scripts/pick-untested-tickers.ts [COUNT] [SEED]
 */
const EXCLUDED = new Set(
  `AAPL,MSFT,NVDA,AMZN,GOOGL,META,BRK.B,JPM,WMT,XOM,JNJ,V,UNH,PG,HD,KO,PEP,COST,MRK,ABBV,TMO,AVGO,MCD,CSCO,ACN,WFC,ORCL,IBM,GE,CAT,BA,DIS,NKE,LOW,RTX,HON,QCOM,SPGI,INTC,AMD,PFE,INTU,AMGN,TXN,PM,MANH,HUBB,DECK,DUOL,PCTY,PEGA,SON,TER,BURL,SRPT,RGEN,GNRC,ITT,MIDD,AIT,BELFB,BIO,IONS,ATMU,NXST,CHTR,FICO,HAS,SAIA,ITW,EMR,ETN,PH,ROP,TDY,ZBRA,POOL,WWD,UFPI,WSC,DOV,ROK,IEX,GNTX,CABO,OPTU,BHC,BLCO,MAGN,GEN,MODG,CALX,SPSC,OSIS,PRGS,PDFS,ATEN,CEVA,ZD,VRA,CRI,GIII,SCVL,SHOO,MGPI,LKFN,NPK,MGRC,TRNS`
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
);

const POOL = [
  "ALGN", "IDXX", "CRL", "TECH", "PSTG", "ODFL", "CVLT", "MSA", "MSM", "ESE",
  "ADC", "LECO", "GPK", "AVNT", "SITE", "FLR", "JBL", "ENTG", "WSO", "WCN",
  "RBC", "PAYX", "FAST", "ROL", "CTAS", "DPZ", "BJ", "ROST", "ULTA", "BBY",
  "RH", "TPR", "CCK", "BERY", "LANC", "WDFC", "SSD", "GEF", "MATX", "KNF",
  "MTH", "MHO", "TMHC", "SKY", "CVCO", "LZB", "LEG", "SNBR", "MLI", "HWKN",
].filter((t) => !EXCLUDED.has(t));

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const count = Math.max(1, parseInt(process.argv[2] ?? "20", 10));
const seed = parseInt(process.argv[3] ?? "20260531", 10);
const rand = mulberry32(seed);
const shuffled = [...POOL].sort(() => rand() - 0.5);
console.log(shuffled.slice(0, count).join(","));
