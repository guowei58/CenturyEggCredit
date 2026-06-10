import { config } from "dotenv";
config({ path: ".env.local" });

import { getCompanyProfile, getAllFilingsByCik } from "../src/lib/sec-edgar.ts";
import { buildPeriodFinancialsFilingLabels } from "../src/lib/period-financials-roic.ts";
import { parseFiscalPeriodToken, resolveDiscoveryAnchorDate } from "../src/lib/presentations/discovery/period.ts";
import { discoverQ4IrPresentations } from "../src/lib/presentations/discovery/adapters/q4-ir.ts";
import { discoverSecPresentationExhibits } from "../src/lib/presentations/discovery/adapters/sec.ts";
import { discoverLiveIrPresentations } from "../src/lib/presentations/discovery/adapters/live-ir.ts";
import { discoverWebSearchPresentations } from "../src/lib/presentations/discovery/adapters/web-search.ts";
import { discoverWaybackPresentations } from "../src/lib/presentations/discovery/adapters/wayback.ts";
import { validatePresentationCandidate } from "../src/lib/presentations/discovery/validate.ts";
import { pickBestCandidate } from "../src/lib/presentations/discovery/score.ts";

const TICKERS = ["CHTR", "NXST", "CABO"];

const SOURCE_LABEL = {
  q4_ir: "Q4 IR financial feed",
  sec_exhibit: "SEC 8-K/6-K exhibit",
  live_ir: "Live IR website crawl",
  wayback: "Wayback Machine archive",
  web_search: "Web search (Serper)",
};

function dedupe(links) {
  const m = new Map();
  for (const l of links) {
    const k = l.url.toLowerCase();
    if (!m.has(k) || l.pre_score > m.get(k).pre_score) m.set(k, l);
  }
  return [...m.values()].sort((a, b) => b.pre_score - a.pre_score);
}

for (const ticker of TICKERS) {
  console.log("\n" + "=".repeat(72));
  console.log(`# ${ticker}`);
  console.log("=".repeat(72));

  const profile = await getCompanyProfile(ticker);
  if (!profile?.cik) {
    console.log("Could not resolve CIK.");
    continue;
  }

  const subs = await getAllFilingsByCik(profile.cik, {
    includeForms: ["10-K", "10-Q"],
    maxFilings: 24,
  });
  const filings = subs?.filings ?? [];
  const labels = buildPeriodFinancialsFilingLabels(
    filings.map((f) => ({
      accessionNumber: f.accessionNumber,
      form: f.form,
      filingDate: f.filingDate,
      reportDate: f.reportDate ?? null,
    }))
  );
  const latest = filings[0];
  const period = latest ? labels.get(latest.accessionNumber) ?? null : null;
  const fp = period ? parseFiscalPeriodToken(period) : null;
  const periodForSearch = fp?.label ?? period;

  if (!periodForSearch) {
    console.log("No fiscal period label derived.");
    continue;
  }

  console.log(`Company: ${profile.name}`);
  console.log(`Period searched: ${periodForSearch}`);
  if (latest) {
    console.log(`Anchor filing: ${latest.form} filed ${latest.filingDate} (report ${latest.reportDate ?? "n/a"})`);
  }

  const input = {
    ticker,
    cik: profile.cik,
    companyName: profile.name,
    period: periodForSearch,
    reportDate: latest?.reportDate ?? latest?.filingDate ?? null,
  };

  const anchorDate = resolveDiscoveryAnchorDate({
    reportDate: input.reportDate,
    period: periodForSearch,
  });

  const [q4, sec, liveIr, web] = await Promise.all([
    discoverQ4IrPresentations(input),
    discoverSecPresentationExhibits(input, anchorDate),
    discoverLiveIrPresentations(input, { anchorDate, irDomains: [], cdnDomains: [] }),
    discoverWebSearchPresentations(input),
  ]);

  const wayback = await discoverWaybackPresentations(
    liveIr.links.slice(0, 5).map((l) => l.source_page_url),
    periodForSearch,
    anchorDate,
    { anchorDate, irDomains: liveIr.irDomains, cdnDomains: liveIr.cdnDomains }
  );

  const merged = dedupe([...q4, ...sec, ...liveIr.links, ...wayback, ...web]);

  console.log(`\nRaw candidates found: ${merged.length}`);
  console.log(`  q4_ir=${q4.length} sec=${sec.length} live_ir=${liveIr.links.length} wayback=${wayback.length} web_search=${web.length}`);

  if (merged.length === 0) {
    console.log("No presentation links discovered.");
    continue;
  }

  console.log("\n--- All discovered presentation links ---\n");
  merged.forEach((raw, i) => {
    console.log(`${i + 1}. ${raw.title}`);
    console.log(`   Source: ${SOURCE_LABEL[raw.source_type] ?? raw.source_type}`);
    console.log(`   PDF/PPT: ${raw.url}`);
    console.log(`   Found via page: ${raw.source_page_url}`);
    console.log(`   Pre-score: ${raw.pre_score} | Evidence: ${raw.evidence.join(", ")}`);
    console.log("");
  });

  const validated = [];
  for (const raw of merged.slice(0, 10)) {
    validated.push(await validatePresentationCandidate(input, raw));
  }
  const best = pickBestCandidate(validated);

  console.log("--- After validation (top picks) ---\n");
  for (const v of validated.sort((a, b) => b.confidence - a.confidence)) {
    const mark = v.url === best?.url ? " ★ BEST" : "";
    console.log(`• ${v.title}${mark}`);
    console.log(`  Confidence: ${v.confidence}% (${v.review_status})`);
    console.log(`  Source: ${SOURCE_LABEL[v.source_type] ?? v.source_type}`);
    console.log(`  URL: ${v.url}`);
    if (v.validation.reject_reason) console.log(`  Reject note: ${v.validation.reject_reason}`);
    console.log("");
  }
}
