import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import type {
  CandidateDiscoveryMethod,
  CandidateAffiliateReviewStatus,
  VerifiedBusinessEntityStatus,
} from "@/generated/prisma/client";
import { normalizeEntityName } from "@/lib/entityNormalize";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;

  const rows = await prisma.candidateAffiliateEntity.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: { affiliationScore: "desc" },
  });
  return NextResponse.json({
    items: rows.map((r) => ({
      ...r,
      formationDate: r.formationDate?.toISOString().slice(0, 10) ?? null,
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

  const name = typeof b.candidateEntityName === "string" ? b.candidateEntityName.trim() : "";
  const method = b.discoveryMethod as CandidateDiscoveryMethod | undefined;
  if (!name || !method) return NextResponse.json({ error: "candidateEntityName and discoveryMethod required" }, { status: 400 });

  const { normalized } = normalizeEntityName(name);

  const row = await prisma.candidateAffiliateEntity.create({
    data: {
      userId,
      ticker,
      candidateEntityName: name,
      normalizedCandidateEntityName: normalized,
      state: typeof b.state === "string" ? b.state.trim().toUpperCase() : "",
      jurisdiction: typeof b.jurisdiction === "string" ? b.jurisdiction : "",
      entityId: typeof b.entityId === "string" ? b.entityId : null,
      entityType: typeof b.entityType === "string" ? b.entityType : null,
      status: (b.status as VerifiedBusinessEntityStatus | undefined) ?? "unknown",
      formationDate: typeof b.formationDate === "string" && b.formationDate ? new Date(String(b.formationDate)) : null,
      registeredAgentName: typeof b.registeredAgentName === "string" ? b.registeredAgentName : null,
      registeredAgentAddress: typeof b.registeredAgentAddress === "string" ? b.registeredAgentAddress : null,
      principalOfficeAddress: typeof b.principalOfficeAddress === "string" ? b.principalOfficeAddress : null,
      mailingAddress: typeof b.mailingAddress === "string" ? b.mailingAddress : null,
      discoveryMethod: method,
      evidenceJson: typeof b.evidenceJson === "object" && b.evidenceJson !== null ? (b.evidenceJson as object) : undefined,
      affiliationScore: typeof b.affiliationScore === "number" ? b.affiliationScore : 0,
      confidence: (b.confidence as "high" | "medium" | "low" | undefined) ?? "low",
      reviewStatus: (b.reviewStatus as CandidateAffiliateReviewStatus | undefined) ?? "unreviewed",
      reasonForFlag: typeof b.reasonForFlag === "string" ? b.reasonForFlag : null,
      sourceName: typeof b.sourceName === "string" ? b.sourceName : null,
      sourceUrl: typeof b.sourceUrl === "string" ? b.sourceUrl : null,
      documentUrl: typeof b.documentUrl === "string" ? b.documentUrl : null,
      notes: typeof b.notes === "string" ? b.notes : null,
    },
  });

  return NextResponse.json({ item: row });
}
