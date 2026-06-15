import "server-only";

import {
  getCapitalStructureExcelBuffer,
  listCapitalStructureExcels,
} from "@/lib/capital-structure-excel";
import type { CreditDocReviewBackground } from "@/lib/credit-doc-review-background-client";
import { extractNotesSheetFromXlsxBuffer } from "@/lib/excel-notes-sheet-extract";
import { getOrgChartExcelBuffer, listOrgChartExcels } from "@/lib/org-chart-excel";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export type { CreditDocReviewBackground } from "@/lib/credit-doc-review-background-client";

async function latestNotesFromExcelList(
  userId: string,
  ticker: string,
  listFn: typeof listCapitalStructureExcels,
  getBufFn: typeof getCapitalStructureExcelBuffer
): Promise<string | null> {
  const items = await listFn(userId, ticker);
  if (!items?.length) return null;
  const latest = items[0];
  if (!latest?.filename) return null;
  const buf = await getBufFn(userId, ticker, latest.filename);
  if (!buf?.length) return null;
  return extractNotesSheetFromXlsxBuffer(buf);
}

export async function collectCreditDocReviewBackground(
  userId: string,
  ticker: string
): Promise<CreditDocReviewBackground | null> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return null;

  const [capitalStructureNotes, orgChartNotes] = await Promise.all([
    latestNotesFromExcelList(userId, safeTicker, listCapitalStructureExcels, getCapitalStructureExcelBuffer),
    latestNotesFromExcelList(userId, safeTicker, listOrgChartExcels, getOrgChartExcelBuffer),
  ]);

  return { capitalStructureNotes, orgChartNotes };
}
