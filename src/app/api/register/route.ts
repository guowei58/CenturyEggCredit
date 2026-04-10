import { NextResponse } from "next/server";
import { hash } from "bcryptjs";
import { Prisma } from "@/generated/prisma/client";
import {
  emailVerificationIdentifier,
  issueEmailVerificationToken,
  sendSignupVerificationEmail,
} from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";
import { emailUsesHostedLlmKeys } from "@/lib/hosted-llm-accounts";
import { defaultUserPreferences } from "@/lib/user-preferences-types";
import { setUserPreferences } from "@/lib/user-preferences-store";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function defaultChatIdFromEmail(email: string): string {
  const rawLocal = (email.split("@")[0] ?? "").trim().toLowerCase();
  // Allow a-z0-9 plus . _ - ; map everything else to '-'
  let s = rawLocal
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[^a-z0-9]+/g, "")
    .replace(/[^a-z0-9]+$/g, "");
  if (!s) s = "pal";
  if (s.length < 3) s = (s + "-pal").slice(0, 3);
  if (s.length > 24) s = s.slice(0, 24).replace(/[^a-z0-9]+$/g, "");
  if (s.length < 3) s = "pal";
  return s;
}

export async function POST(req: Request) {
  let body: { email?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  try {
    const existing = await prisma.user.findUnique({ where: { email: emailRaw } });
    if (existing) {
      return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }

    const passwordHash = await hash(password, 12);
    const localPart = emailRaw.split("@")[0] ?? "User";

    const user = await prisma.user.create({
      data: {
        email: emailRaw,
        name: localPart,
        passwordHash,
      },
      select: { id: true },
    });

    // Default Egg-Hoc chat user ID: email local-part (before "@"), normalized and made unique.
    // If the base is taken, auto-suffix (-2, -3, ...) until unique.
    const base = defaultChatIdFromEmail(emailRaw);
    for (let i = 0; i < 40; i++) {
      const suffix = i === 0 ? "" : `-${i + 1}`;
      const maxBase = Math.max(3, 24 - suffix.length);
      const candidate = (base.length > maxBase ? base.slice(0, maxBase).replace(/[^a-z0-9]+$/g, "") : base) + suffix;
      const prefs = {
        ...defaultUserPreferences(),
        profile: { chatDisplayId: candidate },
        apiKeysSetupPending: !emailUsesHostedLlmKeys(emailRaw),
      };
      const saved = await setUserPreferences(user.id, prefs);
      if (saved.ok) break;
      // If it failed for a reason other than "taken", stop trying.
      if (!/already taken/i.test(saved.error)) break;
    }

    const { token } = await issueEmailVerificationToken(emailRaw);
    const mailed = await sendSignupVerificationEmail(emailRaw, token);
    if (!mailed.ok) {
      await prisma.verificationToken.deleteMany({ where: { identifier: emailVerificationIdentifier(emailRaw) } });
      await prisma.user.delete({ where: { id: user.id } });
      return NextResponse.json(
        { error: mailed.error || "Could not send confirmation email. Try again later." },
        { status: 503 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api/register]", e);
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
    }
    return NextResponse.json(
      {
        error:
          "Could not reach the database from the server. On Vercel + Neon, use the pooled connection string and remove channel_binding=require from DATABASE_URL.",
      },
      { status: 503 }
    );
  }
}
