import { NextResponse } from "next/server";
import { hash } from "bcryptjs";

import { parseEmailFromResetIdentifier } from "@/lib/auth-tokens";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { token?: string; password?: string };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const row = await prisma.verificationToken.findUnique({ where: { token } });
  if (!row || row.expires < new Date()) {
    return NextResponse.json({ error: "Invalid or expired link" }, { status: 400 });
  }

  const email = parseEmailFromResetIdentifier(row.identifier);
  if (!email) {
    return NextResponse.json({ error: "Invalid token" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user?.passwordHash) {
    await prisma.verificationToken.delete({ where: { token } }).catch(() => {});
    return NextResponse.json({ error: "Account not found" }, { status: 400 });
  }

  const passwordHash = await hash(password, 12);

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    }),
    prisma.verificationToken.delete({ where: { token } }),
    prisma.session.deleteMany({ where: { userId: user.id } }),
  ]);

  return NextResponse.json({ ok: true });
}
