import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../../_helpers";
import type { CreditDocumentEntitySourceKind, CreditDocumentPartyRole } from "@/generated/prisma/client";

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

  const existing = await prisma.creditDocumentEntity.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName = typeof body.entityName === "string" ? body.entityName.trim() : existing.entityName;
  const normalized = normalizeEntityName(nextName).normalized;
  const ex = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const entityRole =
    (body.entityRole as CreditDocumentPartyRole | undefined) !== undefined
      ? (body.entityRole as CreditDocumentPartyRole)
      : existing.entityRole;
  const listedInExhibit21 = Boolean(ex);

  const rel = scoreEntityRelevance({
    listedInExhibit21,
    creditRole: entityRole,
    nameRootMatch: true,
    caution: {},
  });
  const conf = scoreEntityConfidence({
    inCreditDocsWithExcerpt:
      typeof body.excerpt === "string"
        ? body.excerpt.length > 0
        : Boolean(existing.excerpt && existing.excerpt.length > 0),
    sourceUrlCaptured:
      typeof body.sourceDocumentUrl === "string" ? Boolean(body.sourceDocumentUrl) : Boolean(existing.sourceDocumentUrl),
  });

  const row = await prisma.creditDocumentEntity.update({
    where: { id },
    data: {
      entityName: typeof body.entityName === "string" ? nextName : undefined,
      normalizedEntityName: typeof body.entityName === "string" ? normalized : undefined,
      sourceDocumentType: (body.sourceDocumentType as CreditDocumentEntitySourceKind | undefined) ?? undefined,
      sourceDocumentTitle:
        typeof body.sourceDocumentTitle === "string" ? body.sourceDocumentTitle : undefined,
      sourceDocumentUrl:
        typeof body.sourceDocumentUrl === "string" ? body.sourceDocumentUrl : undefined,
      sourceDate:
        typeof body.sourceDate === "string"
          ? body.sourceDate
            ? new Date(body.sourceDate)
            : null
          : undefined,
      entityRole: (body.entityRole as CreditDocumentPartyRole | undefined) ?? undefined,
      sectionReference:
        typeof body.sectionReference === "string" ? body.sectionReference : undefined,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : undefined,
      listedInExhibit21,
      relevanceScore: rel,
      confidence: conf,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });

  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const existing = await prisma.creditDocumentEntity.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.creditDocumentEntity.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
