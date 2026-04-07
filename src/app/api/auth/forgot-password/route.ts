import { NextResponse } from "next/server";

import {
  issueEmailVerificationToken,
  issuePasswordResetToken,
  sendPasswordResetEmail,
  sendSignupVerificationEmail,
} from "@/lib/auth-tokens";
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
    select: { id: true, passwordHash: true, emailVerified: true },
  });

  if (!user?.passwordHash) {
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, you will receive instructions shortly.",
    });
  }

  if (!user.emailVerified) {
    const { token } = await issueEmailVerificationToken(emailRaw);
    await sendSignupVerificationEmail(emailRaw, token);
    return NextResponse.json({
      ok: true,
      message: "If an account exists for that email, you will receive instructions shortly.",
    });
  }

  const { token } = await issuePasswordResetToken(emailRaw);
  const mailed = await sendPasswordResetEmail(emailRaw, token);
  if (!mailed.ok) {
    console.error("[forgot-password] email send failed:", mailed.error);
  }

  return NextResponse.json({
    ok: true,
    message: "If an account exists for that email, you will receive instructions shortly.",
  });
}
