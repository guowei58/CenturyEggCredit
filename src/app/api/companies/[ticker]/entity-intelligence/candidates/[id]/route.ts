import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../../_helpers";
import type { CandidateAffiliateReviewStatus } from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

export async function PATCH(request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let b: Record<string, unknown>;
  try {
    b = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const ex = await prisma.candidateAffiliateEntity.findFirst({ where: { id, userId, ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const nextName = typeof b.candidateEntityName === "string" ? b.candidateEntityName.trim() : ex.candidateEntityName;
  const norm = normalizeEntityName(nextName).normalized;

  const row = await prisma.candidateAffiliateEntity.update({
    where: { id },
    data: {
      candidateEntityName: typeof b.candidateEntityName === "string" ? nextName : undefined,
      normalizedCandidateEntityName: typeof b.candidateEntityName === "string" ? norm : undefined,
      reviewStatus: (b.reviewStatus as CandidateAffiliateReviewStatus | undefined) ?? undefined,
      affiliationScore: typeof b.affiliationScore === "number" ? b.affiliationScore : undefined,
      confidence: (b.confidence as "high" | "medium" | "low" | undefined) ?? undefined,
      notes: typeof b.notes === "string" ? b.notes : undefined,
      evidenceJson:
        b.evidenceJson !== undefined
          ? b.evidenceJson === null
            ? undefined
            : (b.evidenceJson as object)
          : undefined,
    },
  });

  return NextResponse.json({ item: row });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const { ticker: raw, id } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const ex = await prisma.candidateAffiliateEntity.findFirst({ where: { id, userId: ctx.userId, ticker: ctx.ticker } });
  if (!ex) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.candidateAffiliateEntity.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
