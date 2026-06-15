import { readSavedContent } from "@/lib/saved-content-hybrid";
import { listUserTickerDocuments } from "@/lib/user-workspace-store";
import { SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";

/** Minimum trimmed length for a saved memo to count as usable for literary/biblical reference generation. */
export const REFERENCE_GEN_MIN_MEMO_CHARS = 120;

/**
 * Markdown save keys for AI Credit Memo tab (default + character voices). Consumed by
 * literary- and biblical-references generation (`generateLiteraryReferences.ts`, `generateBiblicalReferences.ts`).
 * Order: prefer default "latest", then any voice the user generated.
 * Must stay aligned with `POST .../memo` persistence in `memo/route.ts`.
 */
export const CREDIT_MEMO_MARKDOWN_SAVE_KEYS = [
  "ai-credit-memo-latest",
  "ai-credit-memo-shakespeare",
  "ai-credit-memo-buffett",
  "ai-credit-memo-munger",
  "ai-credit-memo-lynch",
  "ai-credit-memo-soros",
  "ai-credit-memo-ackman",
  "ai-credit-memo-kafka",
  "ai-credit-memo-nietzsche",
] as const;

export type CreditMemoMarkdownSaveKey = (typeof CREDIT_MEMO_MARKDOWN_SAVE_KEYS)[number];

export type EligibleSavedCreditMemo = { saveKey: CreditMemoMarkdownSaveKey; text: string };

/** First saved memo at or above `minChars` (trimmed), in priority order (latest first, then voices). */
export async function readFirstEligibleSavedCreditMemoMarkdown(
  ticker: string,
  userId: string,
  minChars: number = REFERENCE_GEN_MIN_MEMO_CHARS
): Promise<EligibleSavedCreditMemo | null> {
  for (const saveKey of CREDIT_MEMO_MARKDOWN_SAVE_KEYS) {
    const raw = (await readSavedContent(ticker, saveKey, userId))?.trim() ?? "";
    if (raw.length >= minChars) return { saveKey, text: raw };
  }
  return null;
}

/**
 * Prefer `ai-credit-memo-latest` when long enough; otherwise first voice memo meeting the bar.
 */
export async function readPreferredSavedCreditMemoMarkdown(
  ticker: string,
  userId: string,
  minChars: number = REFERENCE_GEN_MIN_MEMO_CHARS
): Promise<EligibleSavedCreditMemo | null> {
  const latest = (await readSavedContent(ticker, "ai-credit-memo-latest", userId))?.trim() ?? "";
  if (latest.length >= minChars) {
    return { saveKey: "ai-credit-memo-latest", text: latest };
  }
  for (const saveKey of CREDIT_MEMO_MARKDOWN_SAVE_KEYS) {
    if (saveKey === "ai-credit-memo-latest") continue;
    const raw = (await readSavedContent(ticker, saveKey, userId))?.trim() ?? "";
    if (raw.length >= minChars) return { saveKey, text: raw };
  }
  return null;
}

const REFERENCE_TAB_RESPONSE_MIN_CHARS = 80;

function isSavedTabResponseKey(key: string): boolean {
  if (!(key in SAVED_DATA_FILES)) return false;
  if (key.endsWith("-meta") || key.endsWith("-source-pack") || key.endsWith("-latest")) return false;
  if (key.startsWith("ai-credit-memo-")) return false;
  if (key === "xbrl-deterministic-compiler-result" || key === "entity-mapper-v2-snapshot") return false;
  if (key === "private-workspace-meta") return false;
  const fn = SAVED_DATA_FILES[key]?.toLowerCase() ?? "";
  return fn.endsWith(".txt") || fn.endsWith(".html");
}

/** Saved research-tab response text from Postgres (excludes generated work-product outputs). */
export async function readSavedTabResponsePackForReferenceGeneration(
  ticker: string,
  userId: string,
  minChars: number = REFERENCE_TAB_RESPONSE_MIN_CHARS
): Promise<{ inventory: string; materials: string } | null> {
  const sym = sanitizeWorkspaceKey(ticker);
  if (!sym) return null;

  const rows = await listUserTickerDocuments(userId, sym);
  const blocks: string[] = [];
  const inventoryLines: string[] = [];

  for (const row of rows) {
    if (!isSavedTabResponseKey(row.dataKey)) continue;
    const text = row.content?.trim() ?? "";
    if (text.length < minChars) continue;
    const filename = SAVED_DATA_FILES[row.dataKey] ?? `${row.dataKey}.txt`;
    blocks.push(
      `<<<BEGIN SOURCE: ${filename} (saved tab response) | synthetic>>>\n${text}\n<<<END SOURCE: ${filename}>>>`
    );
    inventoryLines.push(`- ${filename} (saved tab response — ${text.length} chars)`);
  }

  if (blocks.length === 0) return null;
  return {
    inventory: inventoryLines.join("\n"),
    materials: blocks.join("\n\n") + "\n",
  };
}
