import { NextResponse } from "next/server";
import { auth } from "@/auth";

export async function requireUserTicker(rawTicker: string) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const ticker = rawTicker?.trim().toUpperCase() ?? "";
  if (!ticker) return { error: NextResponse.json({ error: "Ticker required" }, { status: 400 }) };

  return { userId, ticker };
}

/** ISO date fields for JSON */
export function serEntityUniverseRow(row: Record<string, unknown>) {
  const r = { ...row };
  for (const k of ["createdAt", "updatedAt", "sourceDate", "filingDate", "formationDate", "checkedAt"]) {
    const v = r[k];
    if (v instanceof Date) r[k] = v.toISOString();
  }
  return r;
}
