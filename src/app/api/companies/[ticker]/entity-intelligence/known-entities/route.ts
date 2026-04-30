import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type { KnownEntityRole, KnownEntitySourceType } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

function ser(row: unknown) {
  if (!row || typeof row !== "object") return row;
  const r = row as Record<string, unknown> & {
    createdAt?: Date;
    updatedAt?: Date;
    sourceDate?: Date | null;
  };
  return {
    ...r,
    sourceDate: r.sourceDate ? r.sourceDate.toISOString().slice(0, 10) : null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : r.updatedAt,
  };
}

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const rows = await prisma.knownEntityInput.findMany({
    where: { userId, ticker },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json({ items: rows.map(ser) });
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

  const sourceType = body.sourceType as KnownEntitySourceType;
  const entityRole = body.entityRole as KnownEntityRole;
  if (!sourceType || !entityRole) {
    return NextResponse.json({ error: "sourceType and entityRole required" }, { status: 400 });
  }

  const { normalized } = normalizeEntityName(entityName);
  const row = await prisma.knownEntityInput.create({
    data: {
      userId,
      ticker,
      entityName,
      normalizedEntityName: normalized,
      sourceType,
      sourceDocumentTitle: typeof body.sourceDocumentTitle === "string" ? body.sourceDocumentTitle : null,
      sourceDocumentUrl: typeof body.sourceDocumentUrl === "string" ? body.sourceDocumentUrl : null,
      sourceDate: typeof body.sourceDate === "string" && body.sourceDate ? new Date(body.sourceDate) : null,
      entityRole,
      jurisdictionHint: typeof body.jurisdictionHint === "string" ? body.jurisdictionHint : null,
      addressHint: typeof body.addressHint === "string" ? body.addressHint : null,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });

  return NextResponse.json({ item: ser(row) });
}
