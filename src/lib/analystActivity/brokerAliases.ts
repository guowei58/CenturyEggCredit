/** Editable broker name normalization map. Keys are lowercase aliases. */
export const BROKER_ALIASES: Record<string, string> = {
  "j.p. morgan": "JPMorgan",
  "jp morgan": "JPMorgan",
  jpmorgan: "JPMorgan",
  "jpmorgan chase": "JPMorgan",
  "jpmorgan securities": "JPMorgan",
  bofa: "BofA Securities",
  "bank of america": "BofA Securities",
  "bank of america securities": "BofA Securities",
  "bofa securities": "BofA Securities",
  rbc: "RBC Capital Markets",
  "rbc capital": "RBC Capital Markets",
  "rbc capital markets": "RBC Capital Markets",
  "goldman sachs": "Goldman Sachs",
  gs: "Goldman Sachs",
  "morgan stanley": "Morgan Stanley",
  ms: "Morgan Stanley",
  citi: "Citigroup",
  citigroup: "Citigroup",
  "citi research": "Citigroup",
  "barclays": "Barclays",
  "deutsche bank": "Deutsche Bank",
  "ubs": "UBS",
  "jefferies": "Jefferies",
  "wells fargo": "Wells Fargo",
  "truist": "Truist Securities",
  "truist securities": "Truist Securities",
  "scotiabank": "Scotiabank",
  "bmo": "BMO Capital Markets",
  "bmo capital markets": "BMO Capital Markets",
  "td securities": "TD Securities",
  "td cowen": "TD Cowen",
  "cowen": "TD Cowen",
  "stephens": "Stephens Inc.",
  "raymond james": "Raymond James",
  "piper sandler": "Piper Sandler",
  "stifel": "Stifel",
  "keybanc": "KeyBanc Capital Markets",
  "william blair": "William Blair",
  "needham": "Needham & Company",
  "canaccord": "Canaccord Genuity",
  "baird": "Robert W. Baird",
  "evercore isi": "Evercore ISI",
  "evercore": "Evercore ISI",
  "bernstein": "Bernstein",
  "sanford c. bernstein": "Bernstein",
  "mizuho": "Mizuho Securities",
  "nomura": "Nomura",
  "macquarie": "Macquarie",
  "credit suisse": "Credit Suisse",
  "hsbc": "HSBC",
  "societe generale": "Societe Generale",
  "bnp paribas": "BNP Paribas",
  "oppenheimer": "Oppenheimer",
  "wedbush": "Wedbush",
  "b. riley": "B. Riley Securities",
  "b riley": "B. Riley Securities",
};

export function normalizeBrokerName(raw: string | null | undefined): string {
  if (!raw?.trim()) return "Unknown";
  const trimmed = raw.trim();
  const lower = trimmed.toLowerCase();
  if (BROKER_ALIASES[lower]) return BROKER_ALIASES[lower];
  for (const [alias, canonical] of Object.entries(BROKER_ALIASES)) {
    if (lower.includes(alias)) return canonical;
  }
  return trimmed.replace(/\s+/g, " ");
}
