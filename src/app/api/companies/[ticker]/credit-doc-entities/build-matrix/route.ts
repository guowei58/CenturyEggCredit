import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { rebuildCreditDocEntityRoleMatrixForTicker } from "@/lib/creditDocs/rebuildCreditDocEntityRoleMatrix";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  try {
    const r = await rebuildCreditDocEntityRoleMatrixForTicker(prisma, {
      userId: ctx.userId,
      ticker: ctx.ticker,
    });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}
