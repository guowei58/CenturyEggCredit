/**
 * Per-user total storage in Postgres (saved docs, workspace blobs, prefs, chat, etc.).
 */

import { prisma } from "@/lib/prisma";

/** 1 GiB per user */
export const USER_STORAGE_LIMIT_BYTES = 1024 * 1024 * 1024;

export const USER_STORAGE_QUOTA_EXCEEDED_MESSAGE =
  "1GB is the limit per user as I'm trying to make this app as free as possible. Storage cost is expensive, and as you've probably calculated, my margin is negative infinity. If you need more storage, please email me at gzhang@centuryeggcredit.com";

/**
 * Sum of byte sizes for all user-owned content stored in the database.
 */
export async function getUserStorageBytesUsed(userId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`
    SELECT (
      COALESCE((SELECT SUM(bytes)::bigint FROM user_saved_documents WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT SUM(octet_length(body))::bigint FROM user_ticker_workspace_files WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT SUM(octet_length(content))::bigint FROM user_ticker_documents WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT (octet_length(payload))::bigint FROM user_preferences WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT SUM(octet_length(payload))::bigint FROM user_ai_chat_state WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT SUM(octet_length(payload_json))::bigint FROM user_daily_news_batches WHERE user_id = ${userId}), 0) +
      COALESCE((SELECT SUM(octet_length(body))::bigint FROM egg_hoc_messages WHERE sender_user_id = ${userId}), 0)
    )::bigint AS total
  `;
  const total = rows[0]?.total ?? BigInt(0);
  return Number(total);
}

/**
 * @param netDeltaBytes — Change in storage from this operation (new − old). Negative or zero always passes.
 */
export async function assertUserStorageAllowsNetDelta(
  userId: string,
  netDeltaBytes: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isFinite(netDeltaBytes) || netDeltaBytes <= 0) {
    return { ok: true };
  }
  const used = await getUserStorageBytesUsed(userId);
  if (used + netDeltaBytes > USER_STORAGE_LIMIT_BYTES) {
    return { ok: false, error: USER_STORAGE_QUOTA_EXCEEDED_MESSAGE };
  }
  return { ok: true };
}
