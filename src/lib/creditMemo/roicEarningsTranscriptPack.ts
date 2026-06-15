import { isCikWorkspaceKey } from "@/lib/company-workspace-key";
import { fetchRoicEarningsTranscriptText } from "@/lib/period-financials-transcript-save";
import { getRoicApiKey } from "@/lib/roic-ai";

function recentQuarterPeriods(count: number): string[] {
  const out: string[] = [];
  const now = new Date();
  let year = now.getFullYear();
  let q = Math.floor(now.getMonth() / 3) + 1;
  q -= 1;
  if (q < 1) {
    q = 4;
    year -= 1;
  }
  for (let i = 0; i < count; i++) {
    out.push(`${year}Q${q}`);
    q -= 1;
    if (q < 1) {
      q = 4;
      year -= 1;
    }
  }
  return out;
}

/** Best-effort historical earnings transcripts from ROIC.AI (skipped for CIK / missing API key). */
export async function fetchRoicHistoricalTranscriptPack(
  ticker: string,
  maxQuarters = 6
): Promise<{ inventory: string; materials: string } | null> {
  const sym = ticker.trim().toUpperCase();
  if (!sym || isCikWorkspaceKey(sym)) return null;

  if (!getRoicApiKey()) return null;

  const blocks: string[] = [];
  const inventoryLines: string[] = [];

  for (const period of recentQuarterPeriods(maxQuarters)) {
    const fetched = await fetchRoicEarningsTranscriptText(sym, period);
    if (!fetched.ok) continue;
    const text = fetched.text.trim();
    if (text.length < 200) continue;
    const filename = `roic-earnings-transcript-${period}.txt`;
    blocks.push(
      `<<<BEGIN SOURCE: ${filename} (ROIC.AI historical earnings call) | synthetic>>>\n${text}\n<<<END SOURCE: ${filename}>>>`
    );
    inventoryLines.push(`- ${filename} (ROIC.AI earnings transcript — ${text.length} chars)`);
  }

  if (blocks.length === 0) return null;
  return {
    inventory: inventoryLines.join("\n"),
    materials: blocks.join("\n\n") + "\n",
  };
}
