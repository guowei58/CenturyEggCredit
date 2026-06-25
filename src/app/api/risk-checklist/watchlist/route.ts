import { NextResponse } from "next/server";
import { requireRiskChecklistAccess } from "@/lib/risk-checklist/api-auth";
import { getRiskPortfolioRows } from "@/lib/risk-checklist/store";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const rows = await getRiskPortfolioRows(access.userId);
  return NextResponse.json({ rows });
}
