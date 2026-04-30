import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type { EntityFilingEventType } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.entityFilingEvent.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ eventDate: "desc" }, { updatedAt: "desc" }],
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      eventDate: r.eventDate?.toISOString().slice(0, 10) ?? null,
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
  const eventType = b.eventType as EntityFilingEventType | undefined;
  if (!entityName || !eventType) return NextResponse.json({ error: "entityName and eventType required" }, { status: 400 });

  const row = await prisma.entityFilingEvent.create({
    data: {
      userId,
      ticker,
      entityRecordId: typeof b.entityRecordId === "string" ? b.entityRecordId : null,
      candidateAffiliateEntityId: typeof b.candidateAffiliateEntityId === "string" ? b.candidateAffiliateEntityId : null,
      entityName,
      eventType,
      eventDate: typeof b.eventDate === "string" && b.eventDate ? new Date(String(b.eventDate)) : null,
      filingNumber: typeof b.filingNumber === "string" ? b.filingNumber : null,
      documentTitle: typeof b.documentTitle === "string" ? b.documentTitle : null,
      documentUrl: typeof b.documentUrl === "string" ? b.documentUrl : null,
      summary: typeof b.summary === "string" ? b.summary : null,
      riskFlag: Boolean(b.riskFlag),
      notes: typeof b.notes === "string" ? b.notes : null,
    },
  });

  return NextResponse.json({ item: row });
}
