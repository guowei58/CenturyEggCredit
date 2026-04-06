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

function defaultChatIdFromEmail(email: string): string | null {
  const e = email.trim().toLowerCase();
  if (!e.includes("@")) return null;
  const rawLocal = (e.split("@")[0] ?? "").trim();
  if (!rawLocal) return null;
  let s = rawLocal
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9]+$/g, "");
  if (!s) return null;
  if (s.length > 24) s = s.slice(0, 24).replace(/[^a-z0-9]+$/g, "");
  if (s.length < 3) return null;
  return s;
}

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  let data = await getUserPreferences(userId);

  // Backfill default chatDisplayId for existing accounts that predate the feature.
  // Uses email local-part (before "@") and persists it if possible (unique-enforced server-side).
  if (!data.profile?.chatDisplayId?.trim()) {
    const email = typeof session?.user?.email === "string" ? session.user.email : "";
    const base = email ? defaultChatIdFromEmail(email) : null;
    if (base) {
      for (let i = 0; i < 40; i++) {
        const suffix = i === 0 ? "" : `-${i + 1}`;
        const maxBase = Math.max(3, 24 - suffix.length);
        const candidate = (base.length > maxBase ? base.slice(0, maxBase).replace(/[^a-z0-9]+$/g, "") : base) + suffix;
        const next: UserPreferencesData = {
          ...data,
          profile: { ...(data.profile ?? {}), chatDisplayId: candidate },
        };
        const saved = await setUserPreferences(userId, next);
        if (saved.ok) {
          data = next;
          break;
        }
        if (!/already taken/i.test(saved.error)) break;
      }
    }
  }
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
