import fs from "fs";
import path from "path";

let cached: string | null = null;

export function getXbrlAiConsolidationInstructions(): string {
  if (cached) return cached;
  const p = path.join(process.cwd(), "src/lib/xbrl-ai-consolidation/consolidation-instructions.txt");
  cached = fs.readFileSync(p, "utf8").trim();
  return cached;
}
