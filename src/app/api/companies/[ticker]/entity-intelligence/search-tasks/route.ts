import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type { EntitySearchTaskReason, EntitySearchTaskWorkflowStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.entitySearchTask.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      checkedAt: r.checkedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const entityName = typeof b.entityName === "string" ? b.entityName.trim() : "";
  const normalizedEntityName = typeof b.normalizedEntityName === "string" ? b.normalizedEntityName.trim() : "";
  const state = typeof b.state === "string" ? b.state.trim().toUpperCase() : "";
  const sourceName = typeof b.sourceName === "string" ? b.sourceName.trim() : "";
  const sourceUrl = typeof b.sourceUrl === "string" ? b.sourceUrl.trim() : "";
  const searchReason = b.searchReason as EntitySearchTaskReason | undefined;
  if (!entityName || !normalizedEntityName || !state || !sourceName || !sourceUrl || !searchReason) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const dup = await prisma.entitySearchTask.findFirst({
    where: {
      userId,
      ticker,
      normalizedEntityName,
      state,
      sourceUrl,
      searchReason,
    },
  });
  if (dup) return NextResponse.json({ item: dup }, { status: 200 });

  const row = await prisma.entitySearchTask.create({
    data: {
      userId,
      ticker,
      entityName,
      normalizedEntityName,
      state,
      sourceName,
      sourceUrl,
      searchReason,
      searchStatus: (b.searchStatus as EntitySearchTaskWorkflowStatus | undefined) ?? "not_started",
      notes: typeof b.notes === "string" ? b.notes : null,
    },
  });

  return NextResponse.json({ item: row });
}
