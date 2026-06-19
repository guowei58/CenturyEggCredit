import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { quarterlyEarningsPackageCoverage } from "@/lib/bulk-earnings-package";
import type { BulkPreflightSnapshotJson } from "@/lib/bulk-update-preflight";
import { listCapitalStructureExcels } from "@/lib/capital-structure-excel";
import { listOrgChartExcels } from "@/lib/org-chart-excel";
import { periodFinancialsBatchFingerprint } from "@/lib/period-financials-batch-save-runner";
import { selectLastNPeriodFinancialsFilings } from "@/lib/period-financials-roic";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { listSavedDocuments } from "@/lib/saved-documents";
import {
  PERIOD_FINANCIALS_FILING_LOOKBACK_YEARS,
  prepareBulkPresentedFilings,
} from "@/lib/sec-xbrl-as-presented-save-client";
import { getAllFilingsByTickerCached } from "@/lib/sec-submissions-cache";
import { listUserTickerDocuments } from "@/lib/user-workspace-store";

export const dynamic = "force-dynamic";

function parseEntityMapperComplete(raw: string | null | undefined): boolean {
  if (!raw?.trim()) return false;
  try {
    const o = JSON.parse(raw) as { version?: number; ticker?: string };
    return o?.version === 2 && typeof o.ticker === "string";
  } catch {
    return false;
  }
}

async function buildPreflightSnapshotJson(userId: string, ticker: string): Promise<BulkPreflightSnapshotJson> {
  const sym = sanitizeTicker(ticker);
  if (!sym) {
    return {
      nonEmptySaveKeys: [],
      hasCapitalStructureExcel: false,
      hasOrgChartExcel: false,
      earningsPackageComplete: false,
      entityMapperComplete: false,
    };
  }

  const [tabDocs, csExcel, orgExcel, savedDocs] = await Promise.all([
    listUserTickerDocuments(userId, sym),
    listCapitalStructureExcels(userId, sym),
    listOrgChartExcels(userId, sym),
    listSavedDocuments(userId, sym),
  ]);

  const nonEmptySaveKeys: string[] = [];
  for (const row of tabDocs) {
    if (row.dataKey?.trim() && row.content.trim().length > 0) {
      nonEmptySaveKeys.push(row.dataKey.trim());
    }
  }

  let earningsPackageComplete = false;
  try {
    const filingsRes = await getAllFilingsByTickerCached(sym);
    if (filingsRes?.filings?.length) {
      const filings = prepareBulkPresentedFilings(filingsRes.filings, {
        lookbackYears: PERIOD_FINANCIALS_FILING_LOOKBACK_YEARS,
      }).map((f) => ({
        form: f.form,
        filingDate: f.filingDate,
        accessionNumber: f.accessionNumber,
        ...(f.reportDate?.trim() ? { reportDate: f.reportDate.trim() } : {}),
        primaryDocument: f.primaryDocument,
      }));
      const fingerprint = periodFinancialsBatchFingerprint(filings);
      const periods = selectLastNPeriodFinancialsFilings(filings);
      if (fingerprint && periods.length > 0) {
        const filenames = (savedDocs ?? []).map((d) => d.filename);
        const coverage = quarterlyEarningsPackageCoverage(sym, filings, filenames);
        earningsPackageComplete = coverage.complete;
      }
    }
  } catch (e) {
    console.warn(`bulk-update-preflight: earnings package check failed for ${sym}:`, e);
  }

  return {
    nonEmptySaveKeys,
    hasCapitalStructureExcel: (csExcel?.length ?? 0) > 0,
    hasOrgChartExcel: (orgExcel?.length ?? 0) > 0,
    earningsPackageComplete,
    entityMapperComplete: parseEntityMapperComplete(
      tabDocs.find((d) => d.dataKey === "entity-mapper-v2-snapshot")?.content
    ),
  };
}

/** Returns saved-state snapshot only — step labels are merged on the client (avoids server importing bulk-ai-open). */
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    const session = await auth();
    const userId = session?.user?.id;
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { ticker: rawTicker } = await params;
    const ticker = sanitizeTicker(rawTicker);
    if (!ticker) {
      return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
    }

    const snapshot = await buildPreflightSnapshotJson(userId, ticker);
    return NextResponse.json(snapshot);
  } catch (e) {
    console.error("bulk-update-preflight error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Preflight check failed" },
      { status: 500 }
    );
  }
}
