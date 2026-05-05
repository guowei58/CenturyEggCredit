import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import type { DebtDocSearchInputs } from "@/lib/creditDocs/edgarDebtDocSearch/types";
import { findCreditDocumentsInDb } from "@/lib/creditDocs/findCreditDocuments";
import { findEdgarDebtDocSearchWithReport, mergeCreditFinderCandidates } from "@/lib/creditDocs/findEdgarCreditDocuments";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const local = await findCreditDocumentsInDb(prisma, {
    userId: ctx.userId,
    ticker: ctx.ticker,
  });

  let searchOpts: Partial<DebtDocSearchInputs> = {};
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      const b = (await req.json()) as Record<string, unknown>;
      if (typeof b.lookbackYears === "number" && Number.isFinite(b.lookbackYears)) {
        searchOpts.lookbackYears = Math.min(40, Math.max(1, Math.floor(b.lookbackYears)));
      }
      if (typeof b.companyName === "string" && b.companyName.trim()) searchOpts.companyName = b.companyName.trim();
      if (typeof b.cik === "string" && b.cik.trim()) searchOpts.cik = b.cik.trim();
      if (b.includeDef14a === true) searchOpts.includeDef14a = true;
    }
  } catch {
    /* optional JSON body */
  }

  let edgarWarning: string | null = null;
  let edgarDebtSearch: Awaited<ReturnType<typeof findEdgarDebtDocSearchWithReport>>["search"] = null;
  let edgar: Awaited<ReturnType<typeof findEdgarDebtDocSearchWithReport>>["candidates"] = [];
  try {
    const r = await findEdgarDebtDocSearchWithReport(ctx.ticker, searchOpts);
    edgar = r.candidates;
    edgarDebtSearch = r.search;
  } catch (e) {
    edgarWarning = e instanceof Error ? e.message : "EDGAR scan failed.";
  }

  const candidates = mergeCreditFinderCandidates(edgar, local);
  return NextResponse.json({ candidates, edgarDebtSearch, edgarWarning });
}
