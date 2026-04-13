import { prisma } from "@/lib/prisma";
import { assertUserStorageAllowsNetDelta } from "@/lib/user-storage-quota";
import { getWatchlistTickers } from "@/lib/user-workspace-store";
import { buildDailyNewsPayload } from "./generate-batch";
import type { DailyNewsBatchPayload } from "./types";
import { lastNDateKeysInNy } from "./dates";

const RETENTION_DAYS = 5;

export async function listDailyNewsBatches(userId: string) {
  return prisma.userDailyNewsBatch.findMany({
    where: { userId },
    orderBy: { batchDateKey: "desc" },
    take: RETENTION_DAYS,
  });
}

export async function getUnreadDailyNewsCount(userId: string): Promise<number> {
  return prisma.userDailyNewsBatch.count({
    where: { userId, isRead: false },
  });
}

export async function markDailyNewsBatchRead(userId: string, batchId: string) {
  const row = await prisma.userDailyNewsBatch.findFirst({
    where: { id: batchId, userId },
  });
  if (!row) return { ok: false as const, error: "Not found" };
  await prisma.userDailyNewsBatch.update({
    where: { id: batchId },
    data: { isRead: true, readAt: new Date() },
  });
  return { ok: true as const };
}

/** Drop batches older than the last RETENTION_DAYS NY calendar keys. */
export async function pruneDailyNewsHistory(userId: string) {
  const keys = lastNDateKeysInNy(RETENTION_DAYS);
  const minKey = keys[keys.length - 1];
  if (!minKey) return;
  await prisma.userDailyNewsBatch.deleteMany({
    where: { userId, batchDateKey: { lt: minKey } },
  });
}

export async function upsertDailyNewsBatch(
  userId: string,
  batchDateKey: string,
  watchlistSignature: string,
  payload: DailyNewsBatchPayload
) {
  const json = JSON.stringify(payload);
  const prev = await prisma.userDailyNewsBatch.findUnique({
    where: { userId_batchDateKey: { userId, batchDateKey } },
    select: { payloadJson: true },
  });
  const oldOctets = prev ? Buffer.byteLength(prev.payloadJson, "utf8") : 0;
  const newOctets = Buffer.byteLength(json, "utf8");
  const quota = await assertUserStorageAllowsNetDelta(userId, newOctets - oldOctets);
  if (!quota.ok) {
    throw new Error(quota.error);
  }
  return prisma.userDailyNewsBatch.upsert({
    where: { userId_batchDateKey: { userId, batchDateKey } },
    create: {
      userId,
      batchDateKey,
      watchlistSignature,
      generatedAt: new Date(payload.generatedAt),
      payloadJson: json,
      isRead: false,
    },
    update: {
      watchlistSignature,
      generatedAt: new Date(payload.generatedAt),
      payloadJson: json,
    },
  });
}

/**
 * Regenerate and store today's batch for a user from their current watchlist.
 */
export async function refreshDailyNewsForUser(userId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const tickers = await getWatchlistTickers(userId);
  if (tickers.length === 0) {
    return { ok: false, error: "Watchlist is empty." };
  }
  try {
    const windowEnd = new Date();
    const { batchDateKey, payload, watchlistSignature } = await buildDailyNewsPayload(tickers, windowEnd);
    await upsertDailyNewsBatch(userId, batchDateKey, watchlistSignature, payload);
    await pruneDailyNewsHistory(userId);
    return { ok: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export async function runDailyNewsForAllUsersWithWatchlists(): Promise<{ users: number; errors: string[] }> {
  const rows = await prisma.user.findMany({
    where: { watchlistEntries: { some: {} } },
    select: { id: true },
  });
  const errors: string[] = [];
  for (const r of rows) {
    const res = await refreshDailyNewsForUser(r.id);
    if (!res.ok) errors.push(`${r.id}: ${res.error}`);
  }
  return { users: rows.length, errors };
}
