import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import type { PublicRecordChecklistStatus } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ ticker: string; id: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw, id } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker || !id) return NextResponse.json({ error: "Invalid" }, { status: 400 });

  const existing = await prisma.publicRecordsChecklistItem.findFirst({ where: { id, userId, ticker } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const checkedAt =
    body.checkedAt !== undefined
      ? body.checkedAt
        ? new Date(String(body.checkedAt))
        : null
      : body.status !== undefined && body.status !== "not_started"
        ? new Date()
        : undefined;

  const item = await prisma.publicRecordsChecklistItem.update({
    where: { id },
    data: {
      status: body.status !== undefined ? (body.status as PublicRecordChecklistStatus) : undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
      entityName: typeof body.entityName === "string" ? body.entityName : undefined,
      jurisdictionName: typeof body.jurisdictionName === "string" ? body.jurisdictionName : undefined,
      checkedAt,
    },
  });

  return NextResponse.json({ item });
}
