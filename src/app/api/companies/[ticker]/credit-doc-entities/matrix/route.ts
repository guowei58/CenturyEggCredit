import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker, serCreditRow } from "../_helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const rows = await prisma.creditDocumentEntityRoleMatrixRow.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ relevanceScore: "desc" }],
  });
  return NextResponse.json({
    matrix: rows.map((r) => serCreditRow(r as unknown as Record<string, unknown>)),
  });
}
