import { NextResponse } from "next/server";

import { issueEmailVerificationToken, sendSignupVerificationEmail } from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { email?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const emailRaw = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!emailRaw || !EMAIL_RE.test(emailRaw)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  const user = await prisma.user.findUnique({
    where: { email: emailRaw },
    select: { passwordHash: true, emailVerified: true },
  });

  if (!user?.passwordHash || user.emailVerified) {
    return NextResponse.json({ ok: true });
  }

  const { token } = await issueEmailVerificationToken(emailRaw);
  const mailed = await sendSignupVerificationEmail(emailRaw, token);
  if (!mailed.ok) {
    return NextResponse.json({ error: mailed.error || "Could not send email." }, { status: 503 });
  }

  return NextResponse.json({ ok: true });
}
