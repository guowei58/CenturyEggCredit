import * as cheerio from "cheerio";
import { createHash } from "crypto";

import { normalizeBrokerName } from "../brokerAliases";
import { scoreEventConfidence } from "../confidence";
import { getSourceConfig } from "../config";
import type { AnalystActivitySourceAdapter, AnalystCoverageRecord, SourceAdapterContext, SourceAdapterResult, SourceAttemptLog } from "../types";

const IR_PATH_HINTS = ["analyst-coverage", "analyst_coverage", "research-coverage", "equity-research", "sell-side"];

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

async function findIrCoverageUrl(
  ticker: string,
  companyName: string | undefined,
  search: SourceAdapterContext["search"]
): Promise<string | null> {
  if (!search) return null;
  const name = companyName?.trim();
  const queries = [
    name ? `"${name}" "analyst coverage" site:*.com/investor` : null,
    name ? `"${name}" "research coverage" "investor relations"` : null,
    `"${ticker}" "analyst coverage" investor relations`,
  ].filter(Boolean) as string[];

  for (const q of queries) {
    const hits = await search.search(q, { num: 5 });
    for (const hit of hits) {
      const lower = hit.url.toLowerCase();
      if (IR_PATH_HINTS.some((h) => lower.includes(h))) return hit.url;
      if (lower.includes("investor") && lower.includes("analyst")) return hit.url;
    }
  }
  return null;
}

function parseCoverageFromHtml(html: string, pageUrl: string): { broker: string; analyst: string | null; email: string | null }[] {
  const $ = cheerio.load(html);
  const rows: { broker: string; analyst: string | null; email: string | null }[] = [];
  $("table tr").each((_, tr) => {
    const cells = $(tr)
      .find("td, th")
      .map((__, td) => $(td).text().replace(/\s+/g, " ").trim())
      .get()
      .filter(Boolean);
    if (cells.length < 2) return;
    const broker = normalizeBrokerName(cells[0]);
    const analyst = cells[1] && cells[1] !== cells[0] ? cells[1] : null;
    const emailMatch = $(tr).text().match(/[\w.+-]+@[\w.-]+\.\w+/);
    if (broker !== "Unknown") rows.push({ broker, analyst, email: emailMatch?.[0] ?? null });
  });

  if (rows.length === 0) {
    const text = $("body").text();
    const lineRe = /([A-Z][A-Za-z&.\s]+(?:Securities|Capital Markets|Research|Bank))\s+[-–—]\s+([A-Z][a-z]+(?:\s+[A-Z]\.?)?\s+[A-Z][a-z]+)/g;
    let m: RegExpExecArray | null;
    while ((m = lineRe.exec(text)) !== null) {
      rows.push({ broker: normalizeBrokerName(m[1]), analyst: m[2].trim(), email: null });
    }
  }
  return rows;
}

export function createCompanyIrAdapter(): AnalystActivitySourceAdapter {
  return {
    id: "company_ir",
    name: "Company IR analyst coverage",
    isEnabled() {
      return getSourceConfig().companyIr;
    },
    async fetch(ctx: SourceAdapterContext): Promise<SourceAdapterResult> {
      const log: SourceAttemptLog = {
        sourceId: "company_ir",
        sourceName: "Company IR analyst coverage",
        status: "skipped",
        rawCount: 0,
        normalizedCount: 0,
      };

      if (!this.isEnabled()) {
        log.message = "Disabled in config";
        return { events: [], coverage: [], log };
      }
      if (!ctx.search) {
        log.message = "No search provider for IR page discovery";
        return { events: [], coverage: [], log };
      }

      try {
        const pageUrl = await findIrCoverageUrl(ctx.ticker, ctx.companyName, ctx.search);
        if (!pageUrl) {
          log.message = "No public IR analyst coverage page found";
          return { events: [], coverage: [], log };
        }

        const res = await fetch(pageUrl, {
          headers: { "User-Agent": "CenturyEggCredit/1.0 (public metadata; contact: app)" },
          next: { revalidate: 0 },
        });
        if (!res.ok) {
          log.status = "blocked";
          log.message = `IR page fetch blocked or unavailable (${res.status})`;
          return { events: [], coverage: [], log };
        }

        const html = await res.text();
        const parsed = parseCoverageFromHtml(html, pageUrl);
        log.rawCount = parsed.length;

        const coverage: AnalystCoverageRecord[] = parsed.map((row) => ({
          id: stableId([ctx.ticker, pageUrl, row.broker, row.analyst ?? ""]),
          ticker: ctx.ticker.toUpperCase(),
          companyName: ctx.companyName ?? null,
          broker: row.broker,
          analystName: row.analyst,
          analystEmail: row.email,
          sourceName: "Company IR",
          sourceUrl: pageUrl,
          sourceType: "company_ir_coverage",
          retrievedAt: ctx.retrievedAt,
          confidenceScore: scoreEventConfidence({
            sourceType: "company_ir_coverage",
            hasDate: false,
            hasBroker: true,
            hasAction: false,
            hasRating: false,
            hasPriceTarget: false,
            hasHeadline: false,
          }),
        }));

        log.normalizedCount = coverage.length;
        log.status = "success";
        return { events: [], coverage, log };
      } catch (e) {
        log.status = "failed";
        log.message = e instanceof Error ? e.message : "Company IR parse failed";
        return { events: [], coverage: [], log };
      }
    },
  };
}
