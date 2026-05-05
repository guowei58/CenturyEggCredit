import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { sendMatrixRowsToEntityUniverse } from "@/lib/creditDocs/mergeCreditDocMatrixIntoUniverse";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: { matrixRowIds?: unknown; force?: unknown; onlyConfirmed?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.matrixRowIds)
    ? body.matrixRowIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (!ids.length) return NextResponse.json({ error: "matrixRowIds required" }, { status: 400 });

  const result = await sendMatrixRowsToEntityUniverse(prisma, {
    userId: ctx.userId,
    ticker: ctx.ticker,
    matrixRowIds: ids,
    force: body.force === true,
    onlyConfirmed: body.onlyConfirmed !== false,
  });
  return NextResponse.json(result);
}
