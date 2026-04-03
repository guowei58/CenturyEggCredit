import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getUserPreferences,
  setUserPreferences,
} from "@/lib/user-preferences-store";
import {
  defaultUserPreferences,
  type UserPreferencesData,
  USER_PREFERENCES_VERSION,
} from "@/lib/user-preferences-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const data = await getUserPreferences(userId);
  return NextResponse.json({ preferences: data });
}

export async function PUT(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let body: { preferences?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const raw = body.preferences;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "preferences object required" }, { status: 400 });
  }
  const o = raw as Partial<UserPreferencesData>;
  if (o.v !== USER_PREFERENCES_VERSION) {
    return NextResponse.json({ error: "Invalid preferences version" }, { status: 400 });
  }
  const merged: UserPreferencesData = {
    ...defaultUserPreferences(),
    ...o,
    v: USER_PREFERENCES_VERSION,
  };
  const result = await setUserPreferences(userId, merged);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
