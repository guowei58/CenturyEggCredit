import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { rebuildEntityUniverseMaster } from "@/lib/rebuildEntityUniverseMaster";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  await prisma.$transaction(async (tx) => rebuildEntityUniverseMaster(tx, userId, ticker));

  const count = await prisma.entityUniverseItem.count({ where: { userId, ticker } });

  return NextResponse.json({ ok: true, masterRowCount: count });
}
