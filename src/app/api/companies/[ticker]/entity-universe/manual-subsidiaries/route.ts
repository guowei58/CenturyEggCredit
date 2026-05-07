import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEntityName } from "@/lib/entityNormalize";
import { requireUserTicker } from "../_helpers";

export const dynamic = "force-dynamic";

type BodyEntry = {
  entityName?: unknown;
  address?: unknown;
  jurisdiction?: unknown;
};

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const { userId, ticker } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const entriesRaw = (body as { entries?: unknown })?.entries;
  if (!Array.isArray(entriesRaw)) {
    return NextResponse.json({ ok: false, error: "Expected { entries: [...] }" }, { status: 400 });
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const rawEntry of entriesRaw as BodyEntry[]) {
    const entityName = typeof rawEntry.entityName === "string" ? rawEntry.entityName.trim() : "";
    if (!entityName) {
      skipped++;
      continue;
    }

    const normalized = normalizeEntityName(entityName).normalized;
    if (!normalized) {
      skipped++;
      continue;
    }

    const address = typeof rawEntry.address === "string" ? rawEntry.address.trim() : "";
    const jurisdiction = typeof rawEntry.jurisdiction === "string" ? rawEntry.jurisdiction.trim() : "";

    const existing = await prisma.entityUniverseItem.findFirst({
      where: {
        userId,
        ticker,
        normalizedEntityName: normalized,
        primarySourceCategory: "user_added",
      },
    });

    if (existing) {
      await prisma.entityUniverseItem.update({
        where: { id: existing.id },
        data: {
          entityName,
          state: jurisdiction,
          jurisdiction,
          principalOfficeAddress: address.length > 0 ? address : null,
        },
      });
      updated++;
    } else {
      await prisma.entityUniverseItem.create({
        data: {
          userId,
          ticker,
          entityName,
          normalizedEntityName: normalized,
          entityRole: "unknown",
          primarySourceCategory: "user_added",
          state: jurisdiction,
          jurisdiction,
          principalOfficeAddress: address.length > 0 ? address : null,
          listedInExhibit21: false,
          reviewStatus: "unreviewed",
        },
      });
      created++;
    }
  }

  return NextResponse.json({
    ok: true,
    created,
    updated,
    skipped,
    message:
      created + updated === 0
        ? "No subsidiaries saved (add at least one legal entity name)."
        : `Saved ${created} new and updated ${updated} manual subsidiary record(s).`,
  });
}
