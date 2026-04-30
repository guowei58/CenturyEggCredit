import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";
import type { KnownEntityRole, KnownEntitySourceType } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const existing = await prisma.knownEntityInput.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName = typeof body.entityName === "string" ? body.entityName.trim() : existing.entityName;
  const { normalized } = normalizeEntityName(nextName);

  const row = await prisma.knownEntityInput.update({
    where: { id },
    data: {
      entityName: typeof body.entityName === "string" ? nextName : undefined,
      normalizedEntityName: typeof body.entityName === "string" ? normalized : undefined,
      sourceType: (body.sourceType as KnownEntitySourceType | undefined) ?? undefined,
      sourceDocumentTitle: typeof body.sourceDocumentTitle === "string" ? body.sourceDocumentTitle : undefined,
      sourceDocumentUrl: typeof body.sourceDocumentUrl === "string" ? body.sourceDocumentUrl : undefined,
      sourceDate:
        typeof body.sourceDate === "string" ? (body.sourceDate ? new Date(body.sourceDate) : null) : undefined,
      entityRole: (body.entityRole as KnownEntityRole | undefined) ?? undefined,
      jurisdictionHint: typeof body.jurisdictionHint === "string" ? body.jurisdictionHint : undefined,
      addressHint: typeof body.addressHint === "string" ? body.addressHint : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });

  return NextResponse.json({ item: row });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.knownEntityInput.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.knownEntityInput.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
