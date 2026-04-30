import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../../_helpers";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.candidateAffiliateEntity.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.candidateAffiliateEntity.update({ where: { id }, data: { reviewStatus: "likely_affiliate" } });
  return NextResponse.json({ item: row });
}
