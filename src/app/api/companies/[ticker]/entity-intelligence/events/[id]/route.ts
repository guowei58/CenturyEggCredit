import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ex = await prisma.entityFilingEvent.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const row = await prisma.entityFilingEvent.update({
    where: { id },
    data: {
      entityName: typeof b.entityName === "string" ? b.entityName : undefined,
      eventType: typeof b.eventType === "string" ? (b.eventType as never) : undefined,
      eventDate:
        typeof b.eventDate === "string"
          ? b.eventDate.trim()
            ? new Date(String(b.eventDate))
            : null
          : undefined,
      summary: typeof b.summary === "string" ? b.summary : undefined,
      documentUrl: typeof b.documentUrl === "string" ? b.documentUrl : undefined,
      riskFlag: typeof b.riskFlag === "boolean" ? b.riskFlag : undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
    },
  });
  return NextResponse.json({ item: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.entityFilingEvent.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.entityFilingEvent.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
