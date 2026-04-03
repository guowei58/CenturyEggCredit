/**
 * Server-only: per-user preferences JSON blob.
 */

import { prisma } from "@/lib/prisma";
import {
  defaultUserPreferences,
  parseUserPreferencesPayload,
  serializeUserPreferencesPayload,
  type UserPreferencesData,
} from "@/lib/user-preferences-types";

const MAX_PREFS_CHARS = 5_000_000;

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
  const payload = serializeUserPreferencesPayload(data);
  if (payload.length > MAX_PREFS_CHARS) {
    return { ok: false, error: "Preferences payload too large." };
  }
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
