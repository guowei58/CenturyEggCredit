import { NextResponse } from "next/server";

import { parseEmailFromVerificationIdentifier } from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  const row = await prisma.verificationToken.findUnique({ where: { token } });
  if (!row || row.expires < new Date()) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const email = parseEmailFromVerificationIdentifier(row.identifier);
  if (!email) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ error: "Account not found" }, { status: 400 });
  }

  if (user.emailVerified) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ ok: true, alreadyVerified: true });
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: new Date() },
    }),
    prisma.verificationToken.delete({ where: { token } }),
  ]);

  return NextResponse.json({ ok: true });
}
