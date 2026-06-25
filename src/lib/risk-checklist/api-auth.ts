import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { canAccessRiskChecklist, canApplyRiskManualOverride } from "./access";

export async function requireRiskChecklistAccess() {
  const session = await auth();
  const userId = session?.user?.id;
  const email = session?.user?.email;
  if (!userId) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (!canAccessRiskChecklist(email)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { userId, email: email ?? null };
}

export async function requireRiskOverrideAccess() {
  const base = await requireRiskChecklistAccess();
  if ("error" in base) return base;
  if (!canApplyRiskManualOverride(base.email)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return base;
}
