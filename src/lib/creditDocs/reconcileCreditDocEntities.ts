import type { PrismaClient } from "@/generated/prisma/client";

/** Exhibit 21 + consolidated universe normalized names for this ticker/workspace. */
export async function reconciliationContext(
  prisma: Pick<PrismaClient, "exhibit21Subsidiary" | "entityUniverseItem">,
  userId: string,
  ticker: string
): Promise<{ exhibit21Norms: Set<string>; universeNorms: Set<string> }> {
  const [ex, uni] = await Promise.all([
    prisma.exhibit21Subsidiary.findMany({ where: { userId, ticker }, select: { normalizedEntityName: true } }),
    prisma.entityUniverseItem.findMany({ where: { userId, ticker }, select: { normalizedEntityName: true } }),
  ]);
  return {
    exhibit21Norms: new Set(ex.map((r) => r.normalizedEntityName)),
    universeNorms: new Set(uni.map((r) => r.normalizedEntityName)),
  };
}
