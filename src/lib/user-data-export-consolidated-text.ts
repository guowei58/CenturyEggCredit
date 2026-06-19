import { generatedWorkProductTabDataKeys } from "@/lib/kpi-workspace-sources";
import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";

/** Zip basename for the per-ticker combined export. */
export const CONSOLIDATED_TEXTFILE_NAME = "CONSOLIDATED TEXTFILE.txt";

/** Work-product save keys omitted from the consolidated textfile. */
export const CONSOLIDATED_EXCLUDED_WORK_PRODUCT_KEYS = [
  "literary-references-latest",
  "biblical-references-latest",
  "how-to-look-like-a-dumbass-latest",
  "next-quarter-earnings-transcript-latest",
] as const;

const WORK_PRODUCT_KEYS = generatedWorkProductTabDataKeys();

/** Preferred work-product order after information-gathering tabs. */
const WORK_PRODUCT_ORDER: string[] = [
  "kpi-latest",
  "forensic-accounting-latest",
  "lme-analysis",
  "cs-recommendation-latest",
  "entity-mapper-latest",
  "entity-mapper-sec-debt-index",
  "ai-credit-memo-latest",
  "ai-credit-deck",
  "credit-decision-dashboard-latest",
];

function tabFilenameForDataKey(dataKey: string): string {
  if (Object.prototype.hasOwnProperty.call(SAVED_DATA_FILES, dataKey)) {
    return SAVED_DATA_FILES[dataKey as keyof typeof SAVED_DATA_FILES];
  }
  const safe = dataKey.replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${safe}.txt`;
}

function humanSectionTitle(dataKey: string, filename: string): string {
  const fromKey = dataKey
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return `${fromKey} (${filename})`;
}

export function isExcludedConsolidatedWorkProductDataKey(dataKey: string): boolean {
  return CONSOLIDATED_EXCLUDED_WORK_PRODUCT_KEYS.some(
    (prefix) => dataKey === prefix || dataKey.startsWith(`${prefix}-`)
  );
}

function isMetaOrSourcePack(dataKey: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    dataKey.endsWith("-meta") ||
    dataKey.endsWith("-source-pack") ||
    lower.includes("-meta.") ||
    lower.includes("-source-pack.")
  );
}

/** True when a saved-tab row belongs in the consolidated textfile. */
export function shouldIncludeInConsolidatedTextfile(dataKey: string, filename: string): boolean {
  const lower = filename.toLowerCase();
  if (!lower.endsWith(".txt") && !lower.endsWith(".md")) return false;
  if (isMetaOrSourcePack(dataKey, filename)) return false;

  const isWorkProduct = WORK_PRODUCT_KEYS.has(dataKey);
  if (isWorkProduct) {
    if (isExcludedConsolidatedWorkProductDataKey(dataKey)) return false;
    return lower.endsWith(".txt") || lower.endsWith(".md");
  }

  // Information-gathering / response-box tabs: text exports only.
  return lower.endsWith(".txt") || lower.endsWith(".md");
}

function sortConsolidatedSections(
  a: { dataKey: string; filename: string },
  b: { dataKey: string; filename: string }
): number {
  const aWp = WORK_PRODUCT_KEYS.has(a.dataKey);
  const bWp = WORK_PRODUCT_KEYS.has(b.dataKey);
  if (aWp !== bWp) return aWp ? 1 : -1;

  if (aWp && bWp) {
    const ai = WORK_PRODUCT_ORDER.indexOf(a.dataKey);
    const bi = WORK_PRODUCT_ORDER.indexOf(b.dataKey);
    const ar = ai >= 0 ? ai : 999;
    const br = bi >= 0 ? bi : 999;
    if (ar !== br) return ar - br;
    if (a.dataKey.startsWith("ai-credit-memo-") && b.dataKey.startsWith("ai-credit-memo-")) {
      return a.dataKey.localeCompare(b.dataKey);
    }
  }

  return a.filename.localeCompare(b.filename, undefined, { sensitivity: "base" });
}

export type ConsolidatedTextSection = {
  dataKey: string;
  filename: string;
  content: string;
};

/** Merge filtered saved-tab sections into one plain-text document. */
export function assembleConsolidatedTextfile(sections: ConsolidatedTextSection[], ticker: string): string {
  const sym = ticker.trim().toUpperCase();
  const header = [
    `CONSOLIDATED TEXTFILE — ${sym}`,
    "Combined information-gathering response boxes and work-product outputs.",
    "Excluded: Literary References, Biblical References, Shorting at 50c, Next Quarter Earnings Transcript.",
    "",
  ].join("\n");

  if (sections.length === 0) {
    return `${header}(No included saved-tab text for this ticker.)\n`;
  }

  const parts = [header];
  for (const section of sections) {
    parts.push(
      "=".repeat(80),
      humanSectionTitle(section.dataKey, section.filename),
      "=".repeat(80),
      "",
      section.content.trim(),
      "",
      ""
    );
  }
  return parts.join("\n");
}

/** Build consolidated sections from saved-tab rows (already loaded). */
export function buildConsolidatedSectionsFromRows(
  rows: Array<{ dataKey: string; content: string }>
): ConsolidatedTextSection[] {
  const sections: ConsolidatedTextSection[] = [];
  for (const row of rows) {
    const content = row.content?.trim() ?? "";
    if (!content) continue;
    const filename = tabFilenameForDataKey(row.dataKey);
    if (!shouldIncludeInConsolidatedTextfile(row.dataKey, filename)) continue;
    sections.push({ dataKey: row.dataKey, filename, content });
  }
  sections.sort(sortConsolidatedSections);
  return sections;
}

export function buildConsolidatedTextfileFromRows(
  ticker: string,
  rows: Array<{ dataKey: string; content: string }>
): string | null {
  const sections = buildConsolidatedSectionsFromRows(rows);
  if (sections.length === 0) return null;
  return assembleConsolidatedTextfile(sections, ticker);
}
