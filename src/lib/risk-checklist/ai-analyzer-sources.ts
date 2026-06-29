import { sanitizeTicker, SAVED_DATA_FILES } from "@/lib/saved-ticker-data";
import { tierForExtractedBody } from "@/lib/lme-tier-classify";
import { listUserTickerDocuments } from "@/lib/user-workspace-store";

export type RiskChecklistSourcePart = {
  label: string;
  key: string;
  filename: string;
  content: string;
  chars: number;
};

const SKIP_SUFFIXES = ["-meta", "-source-pack"] as const;

function includeSavedTab(dataKey: string, filename: string): boolean {
  if (SKIP_SUFFIXES.some((s) => dataKey.endsWith(s))) return false;
  const fn = filename.trim().toLowerCase();
  if (fn.endsWith(".json")) return false;
  return fn.endsWith(".txt") || fn.endsWith(".md") || fn.endsWith(".html") || fn.endsWith(".htm");
}

function clip(text: string, max: number): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}\n\n…[truncated]`;
}

export async function gatherRiskChecklistSavedSources(
  userId: string,
  ticker: string
): Promise<RiskChecklistSourcePart[]> {
  const sym = sanitizeTicker(ticker);
  if (!sym) return [];

  const tabRows = await listUserTickerDocuments(userId, sym);
  const parts: RiskChecklistSourcePart[] = [];

  for (const row of tabRows) {
    if (!(row.dataKey in SAVED_DATA_FILES)) continue;
    const filename = SAVED_DATA_FILES[row.dataKey as keyof typeof SAVED_DATA_FILES];
    if (!includeSavedTab(row.dataKey, filename)) continue;
    const raw = row.content?.trim() ?? "";
    if (!raw) continue;
    tierForExtractedBody(filename, raw);
    parts.push({
      label: row.dataKey,
      key: row.dataKey,
      filename,
      content: raw,
      chars: raw.length,
    });
  }

  parts.sort((a, b) => a.filename.localeCompare(b.filename));
  return parts;
}

export function formatRiskChecklistSourcesForPrompt(
  ticker: string,
  parts: RiskChecklistSourcePart[],
  charBudget = 350_000
): { text: string; included: number; totalChars: number } {
  const sym = ticker.trim().toUpperCase();
  let budget = charBudget;
  const chunks: string[] = [
    `Ticker: ${sym}`,
    `Saved research responses (${parts.length} file(s)):`,
    parts.map((p) => `- ${p.filename} (${p.chars.toLocaleString()} chars)`).join("\n"),
    "",
    "========== SAVED RESPONSE CONTENTS ==========",
  ];
  budget -= chunks.join("\n").length;

  let included = 0;
  for (const part of parts) {
    if (budget < 500) break;
    const head = `\n---------- ${part.filename} (${part.label}) ----------\n`;
    const maxBody = Math.max(0, budget - head.length - 20);
    if (maxBody < 200) break;
    const body = clip(part.content, Math.min(95_000, maxBody));
    const block = head + body + "\n";
    chunks.push(block);
    budget -= block.length;
    included += 1;
  }

  return {
    text: chunks.join("\n"),
    included,
    totalChars: parts.reduce((s, p) => s + p.chars, 0),
  };
}
