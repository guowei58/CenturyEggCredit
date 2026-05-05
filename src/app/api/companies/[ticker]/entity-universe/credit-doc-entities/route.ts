import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { scoreEntityRelevance } from "@/lib/scoreEntityRelevance";
import { scoreEntityConfidence } from "@/lib/scoreEntityConfidence";
import { requireUserTicker, serEntityUniverseRow } from "../_helpers";
import type { CreditDocumentEntitySourceKind, CreditDocumentPartyRole } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;
  const items = await prisma.creditDocumentEntity.findMany({ where: { userId, ticker }, orderBy: { updatedAt: "desc" } });
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
  const sourceDocumentType = body.sourceDocumentType as CreditDocumentEntitySourceKind;
  const entityRole = body.entityRole as CreditDocumentPartyRole;
  if (!sourceDocumentType || !entityRole) {
    return NextResponse.json({ error: "sourceDocumentType and entityRole required" }, { status: 400 });
  }
  const { normalized } = normalizeEntityName(entityName);
  const ex = await prisma.exhibit21Subsidiary.findFirst({ where: { userId, ticker, normalizedEntityName: normalized } });
  const listedInExhibit21 = Boolean(ex);
  const rel = scoreEntityRelevance({
    listedInExhibit21,
    creditRole: entityRole,
    nameRootMatch: true,
    caution: {},
  });
  const conf = scoreEntityConfidence({
    inCreditDocsWithExcerpt: typeof body.excerpt === "string" && body.excerpt.length > 0,
    sourceUrlCaptured: typeof body.sourceDocumentUrl === "string" && body.sourceDocumentUrl.length > 0,
  });
  const row = await prisma.creditDocumentEntity.create({
    data: {
      userId,
      ticker,
      entityName,
      normalizedEntityName: normalized,
      sourceDocumentType,
      sourceDocumentTitle: typeof body.sourceDocumentTitle === "string" ? body.sourceDocumentTitle : "",
      sourceDocumentUrl: typeof body.sourceDocumentUrl === "string" ? body.sourceDocumentUrl : null,
      sourceDate: typeof body.sourceDate === "string" && body.sourceDate ? new Date(body.sourceDate) : null,
      entityRole,
      sectionReference: typeof body.sectionReference === "string" ? body.sectionReference : null,
      excerpt: typeof body.excerpt === "string" ? body.excerpt : null,
      listedInExhibit21,
      relevanceScore: rel,
      confidence: conf,
      notes: typeof body.notes === "string" ? body.notes : null,
    },
  });
  return NextResponse.json({ item: serEntityUniverseRow(row as unknown as Record<string, unknown>) });
}
