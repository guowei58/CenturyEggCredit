/**
 * Server-only: per-user preferences JSON blob.
 */

import { prisma } from "@/lib/prisma";
import { assertUserStorageAllowsNetDelta } from "@/lib/user-storage-quota";
import {
  defaultUserPreferences,
  parseUserPreferencesPayload,
  serializeUserPreferencesPayload,
  type UserPreferencesData,
} from "@/lib/user-preferences-types";

const MAX_PREFS_CHARS = 5_000_000;

function normalizeChatDisplayId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const t = raw.trim().toLowerCase();
  if (!t) return null;
  if (t.length < 3 || t.length > 24) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(t)) return null;
  return t;
}

export async function getUserPreferences(userId: string): Promise<UserPreferencesData> {
  const row = await prisma.userPreferences.findUnique({
    where: { userId },
  });
  return parseUserPreferencesPayload(row?.payload ?? null);
}

export async function setUserPreferences(
  userId: string,
  data: UserPreferencesData
): Promise<{ ok: true } | { ok: false; error: string }> {
  // Enforce uniqueness for chatDisplayId (stored inside payload JSON).
  const nextChatId = normalizeChatDisplayId(data.profile?.chatDisplayId);
  if (data.profile?.chatDisplayId !== undefined) {
    // If the caller provided it but it normalizes to null, reject with a helpful error.
    if (!nextChatId) {
      return {
        ok: false,
        error:
          "Invalid chat ID. Use 3–24 chars: letters/numbers, plus '.', '_' or '-'. Must start with a letter/number.",
      };
    }
    // Persist normalized value.
    data = { ...data, profile: { ...(data.profile ?? {}), chatDisplayId: nextChatId } };

    // Look for other users using the same chatDisplayId.
    // Note: payload is JSON.stringify'd with no whitespace, so this needle is stable.
    const needle = `"chatDisplayId":"${nextChatId.replace(/"/g, '\\"')}"`;
    const clash = await prisma.userPreferences.findFirst({
      where: { userId: { not: userId }, payload: { contains: needle } },
      select: { userId: true },
    });
    if (clash) {
      return { ok: false, error: "That chat ID is already taken. Please choose another one." };
    }
  }

  const payload = serializeUserPreferencesPayload(data);
  if (payload.length > MAX_PREFS_CHARS) {
    return { ok: false, error: "Preferences payload too large." };
  }
  const prevRow = await prisma.userPreferences.findUnique({
    where: { userId },
    select: { payload: true },
  });
  const oldOctets = prevRow ? Buffer.byteLength(prevRow.payload, "utf8") : 0;
  const newOctets = Buffer.byteLength(payload, "utf8");
  const quota = await assertUserStorageAllowsNetDelta(userId, newOctets - oldOctets);
  if (!quota.ok) return quota;
  try {
    await prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, payload },
      update: { payload },
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed" };
  }
}

export async function getUserPreferencesPayloadString(userId: string): Promise<string> {
  const row = await prisma.userPreferences.findUnique({
    where: { userId },
  });
  return row?.payload ?? serializeUserPreferencesPayload(defaultUserPreferences());
}
