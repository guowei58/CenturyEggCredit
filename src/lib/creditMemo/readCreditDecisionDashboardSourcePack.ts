import { readSavedContent } from "@/lib/saved-content-hybrid";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";
import {
  CREDIT_MEMO_MARKDOWN_SAVE_KEYS,
  readSavedTabResponsePackForReferenceGeneration,
} from "./savedMemoForReferenceTabs";

const WORK_PRODUCT_SAVE_KEYS = [
  "kpi-latest",
  "forensic-accounting-latest",
  "lme-analysis",
  "cs-recommendation-latest",
  "how-to-look-like-a-dumbass-latest",
  "next-quarter-earnings-transcript-latest",
  "literary-references-latest",
  "biblical-references-latest",
] as const;

const MIN_WORK_PRODUCT_CHARS = 120;
const MIN_MEMO_CHARS = 120;

/** Comprehensive saved research pack for Credit Decision Dashboard generation. */
export async function readCreditDecisionDashboardSourcePack(
  ticker: string,
  userId: string
): Promise<{ inventory: string; materials: string } | null> {
  const sym = sanitizeWorkspaceKey(ticker);
  if (!sym) return null;

  const blocks: string[] = [];
  const inventoryLines: string[] = [];

  for (const saveKey of CREDIT_MEMO_MARKDOWN_SAVE_KEYS) {
    const text = (await readSavedContent(sym, saveKey, userId))?.trim() ?? "";
    if (text.length < MIN_MEMO_CHARS) continue;
    const filename = `${saveKey}.md`;
    blocks.push(
      `<<<BEGIN SOURCE: ${filename} (AI credit memo) | synthetic>>>\n${text}\n<<<END SOURCE: ${filename}>>>`
    );
    inventoryLines.push(`- ${filename} (AI credit memo — ${text.length} chars)`);
  }

  for (const saveKey of WORK_PRODUCT_SAVE_KEYS) {
    const text = (await readSavedContent(sym, saveKey, userId))?.trim() ?? "";
    if (text.length < MIN_WORK_PRODUCT_CHARS) continue;
    const filename = `${saveKey}.md`;
    blocks.push(
      `<<<BEGIN SOURCE: ${filename} (saved work product) | synthetic>>>\n${text}\n<<<END SOURCE: ${filename}>>>`
    );
    inventoryLines.push(`- ${filename} (work product — ${text.length} chars)`);
  }

  const tabPack = await readSavedTabResponsePackForReferenceGeneration(sym, userId);
  if (tabPack) {
    blocks.push(tabPack.materials);
    inventoryLines.push(tabPack.inventory);
  }

  if (blocks.length === 0) return null;
  return {
    inventory: inventoryLines.join("\n"),
    materials: blocks.join("\n\n") + "\n",
  };
}
