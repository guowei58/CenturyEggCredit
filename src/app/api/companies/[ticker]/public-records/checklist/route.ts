import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { PublicRecordCategory, PublicRecordChecklistStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const items = await prisma.publicRecordsChecklistItem.findMany({
    where: { userId, ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ items });
}

/** Upsert checklist row by sourceKey */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const sourceKey = typeof body.sourceKey === "string" ? body.sourceKey : "";
  const category = body.category as PublicRecordCategory | undefined;
  if (!sourceKey || !category) return NextResponse.json({ error: "sourceKey and category required" }, { status: 400 });

  const status = (body.status as PublicRecordChecklistStatus) ?? "not_started";
  const checkedAt = body.checkedAt ? new Date(String(body.checkedAt)) : status !== "not_started" ? new Date() : null;

  const item = await prisma.publicRecordsChecklistItem.upsert({
    where: {
      userId_ticker_sourceKey: { userId, ticker, sourceKey },
    },
    create: {
      userId,
      ticker,
      category,
      sourceKey,
      entityName: typeof body.entityName === "string" ? body.entityName : null,
      jurisdictionName: typeof body.jurisdictionName === "string" ? body.jurisdictionName : null,
      status,
      notes: typeof body.notes === "string" ? body.notes : null,
      checkedAt,
    },
    update: {
      category,
      entityName: typeof body.entityName === "string" ? body.entityName : undefined,
      jurisdictionName: typeof body.jurisdictionName === "string" ? body.jurisdictionName : undefined,
      status,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      checkedAt,
    },
  });

  return NextResponse.json({ item });
}
