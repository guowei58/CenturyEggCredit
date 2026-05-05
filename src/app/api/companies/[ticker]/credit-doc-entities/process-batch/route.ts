import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserTicker } from "../_helpers";
import { processCreditDocumentSource } from "@/lib/creditDocs/processCreditDocumentSource";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: { documentIds?: unknown };
  try {
    body = (await req.json()) as { documentIds?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const ids = Array.isArray(body.documentIds)
    ? body.documentIds.filter((x): x is string => typeof x === "string" && x.length > 0)
    : [];
  if (!ids.length) return NextResponse.json({ error: "documentIds required" }, { status: 400 });

  const results: Array<{ documentId: string } & Awaited<ReturnType<typeof processCreditDocumentSource>> | { documentId: string; error: string }> =
    [];
  for (const documentId of ids) {
    try {
      const r = await processCreditDocumentSource(prisma, {
        userId: ctx.userId,
        ticker: ctx.ticker,
        documentId,
      });
      results.push({ documentId, ...r });
    } catch (e) {
      results.push({ documentId, error: e instanceof Error ? e.message : "failed" });
    }
  }
  return NextResponse.json({ results });
}
