import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { MAX_PREFS_CHARS } from "@/lib/user-preferences-types";
import { getUserStorageBytesUsed, USER_STORAGE_LIMIT_BYTES } from "@/lib/user-storage-quota";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const row = await prisma.userPreferences.findUnique({
    where: { userId },
    select: { payload: true },
  });
  const preferencesPayloadChars = row ? row.payload.length : 0;
  const preferencesPayloadBytes = row ? Buffer.byteLength(row.payload, "utf8") : 0;
  const totalBytesUsed = await getUserStorageBytesUsed(userId);

  return NextResponse.json({
    preferencesPayloadChars,
    preferencesPayloadBytes,
    totalBytesUsed,
    limitBytes: USER_STORAGE_LIMIT_BYTES,
    maxPreferencesChars: MAX_PREFS_CHARS,
  });
}
