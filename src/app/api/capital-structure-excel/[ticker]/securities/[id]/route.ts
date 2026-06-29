import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  deleteCapitalStructureSecurity,
  updateCapitalStructureSecurity,
} from "@/lib/capital-structure-securities";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticker: string; id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker, id } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: Record<string, string | null | undefined>;
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const security = await updateCapitalStructureSecurity(userId, sym, id, body);
  if (!security) return NextResponse.json({ error: "Security not found" }, { status: 404 });

  return NextResponse.json({ security });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ ticker: string; id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker, id } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const ok = await deleteCapitalStructureSecurity(userId, sym, id);
  if (!ok) return NextResponse.json({ error: "Security not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
