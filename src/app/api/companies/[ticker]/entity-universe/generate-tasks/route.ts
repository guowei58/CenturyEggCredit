import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { generateEntityDiscoveryTasksDraft } from "@/lib/generateEntityDiscoveryTasks";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const profile = await prisma.entityIntelligenceProfile.findFirst({
    where: { userId, ticker },
    select: {
      publicRegistrantName: true,
      companyName: true,
      hqState: true,
      principalExecutiveOfficeAddress: true,
      majorOperatingStates: true,
    },
  });

  const exhibitSubs = await prisma.exhibit21Subsidiary.findMany({
    where: { userId, ticker },
    select: { entityName: true, jurisdiction: true },
  });
  const creditRows = await prisma.creditDocumentEntity.findMany({
    where: { userId, ticker },
    select: { entityName: true, normalizedEntityName: true },
  });
  const creditPartyNames = [...new Map(creditRows.map((c) => [c.normalizedEntityName, { entityName: c.entityName }])).values()];

  const drafts = generateEntityDiscoveryTasksDraft({
    profile,
    exhibitSubs,
    creditPartyNames,
    ticker,
  });

  await prisma.$transaction(async (tx) => {
    await tx.entityUniverseDiscoveryTask.deleteMany({ where: { userId, ticker } });
    if (drafts.length === 0) return;
    await tx.entityUniverseDiscoveryTask.createMany({
      data: drafts.map((d) => ({
        userId,
        ticker,
        taskCategory: d.taskCategory,
        taskSubtype: d.taskSubtype ?? null,
        sourceCategory: d.sourceCategory,
        searchTerm: d.searchTerm ?? null,
        state: d.state ?? null,
        jurisdiction: d.jurisdiction,
        sourceUrl: d.sourceUrl ?? null,
        instructions: d.instructions,
        status: d.status,
        notes: null,
        checkedAt: null,
      })),
    });
  });

  const count = await prisma.entityUniverseDiscoveryTask.count({ where: { userId, ticker } });
  return NextResponse.json({ ok: true, tasksCreated: count });
}
