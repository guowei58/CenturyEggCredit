import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { getAllFilingsByTicker } from "@/lib/sec-edgar";
import {
  selectLastNPeriodFinancialsFilings,
  filingPeriodLabelToRoicPeriod,
} from "@/lib/period-financials-roic";
import { fetchRoicEarningsTranscriptText } from "@/lib/period-financials-transcript-save";
import { getRoicApiKey } from "@/lib/roic-ai";

async function main() {
  const tk = "GEN";
  const apiKey = getRoicApiKey();
  if (!apiKey) throw new Error("no api key");

  for (const f of periods) {
    const roic = filingPeriodLabelToRoicPeriod(f.periodLabel, f.reportDate, f.filingDate);
    console.log("---", f.periodLabel, roic);
    if (!roic) continue;
    const tr = await fetchRoicEarningsTranscriptText(tk, roic);
    console.log(tr.ok ? `OK len=${tr.text.length} sym=${tr.roicSymbol}` : tr.error);
  }
}

void main();
