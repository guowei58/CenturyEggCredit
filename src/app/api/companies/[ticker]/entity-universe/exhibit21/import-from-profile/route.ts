import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { syncExhibit21SubsidiariesFromPublicProfile } from "@/lib/syncExhibit21FromPublicProfile";
import { requireUserTicker } from "../../_helpers";

export const dynamic = "force-dynamic";

/** Explicit re-sync from Public Records profile (usually unnecessary — bootstrap GET syncs automatically). */
export async function POST(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const prof = await prisma.publicRecordsProfile.findFirst({ where: { userId, ticker } });
  if (!prof) return NextResponse.json({ error: "No public records profile for ticker" }, { status: 404 });

  const stats = await syncExhibit21SubsidiariesFromPublicProfile(prisma, userId, ticker);

  return NextResponse.json(stats);
}
