import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  const items = await prisma.exhibit21Subsidiary.findMany({
    where: { userId, ticker },
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({ items: items.map((r) => serEntityUniverseRow(r as unknown as Record<string, unknown>)) });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const entityName = typeof body.entityName === "string" ? body.entityName.trim() : "";
  if (!entityName) return NextResponse.json({ error: "entityName required" }, { status: 400 });
  const { normalized } = normalizeEntityName(entityName);
  const row = await prisma.exhibit21Subsidiary.create({
    data: {
      userId,
      ticker,
      entityName,
      normalizedEntityName: normalized,
      jurisdiction: typeof body.jurisdiction === "string" ? body.jurisdiction : null,
      source10KTitle: typeof body.source10KTitle === "string" ? body.source10KTitle : null,
      source10KUrl: typeof body.source10KUrl === "string" ? body.source10KUrl : null,
      fiscalYear: typeof body.fiscalYear === "string" ? body.fiscalYear : null,
      listedAsSignificant: Boolean(body.listedAsSignificant),
      materialityNote: typeof body.materialityNote === "string" ? body.materialityNote : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}
