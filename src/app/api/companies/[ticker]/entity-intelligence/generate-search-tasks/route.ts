import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { generateEntitySearchTasks } from "@/lib/generateEntitySearchTasks";
import { buildEntityIntelProfileInput } from "@/lib/entityIntelAggregateInput";

export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  const { input, customSourcesReturn } = await buildEntityIntelProfileInput(userId, ticker);
  const drafts = generateEntitySearchTasks(input, { customSources: customSourcesReturn });

  let created = 0;
  for (const d of drafts) {
    const dup = await prisma.entitySearchTask.findFirst({
      where: {
        userId,
        ticker,
        normalizedEntityName: d.normalizedEntityName,
        state: d.state,
        sourceUrl: d.sourceUrl,
        searchReason: d.searchReason,
      },
    });
    if (dup) continue;
    await prisma.entitySearchTask.create({
      data: {
        userId,
        ticker,
        entityName: d.entityName,
        normalizedEntityName: d.normalizedEntityName,
        state: d.state,
        sourceName: d.sourceName,
        sourceUrl: d.sourceUrl,
        searchReason: d.searchReason,
      },
    });
    created++;
  }

  return NextResponse.json({ created, totalDrafted: drafts.length });
}
