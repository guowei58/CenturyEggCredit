import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { inferCreditDocumentTitleType } from "@/lib/creditDocs/findCreditDocuments";
import { requireUserTicker, serCreditRow } from "../_helpers";
import type { CreditDocSourceDocumentType, CreditDocSourceFilingKind } from "@/generated/prisma/client";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  const documents = await prisma.creditDocumentSource.findMany({
    where: { userId: ctx.userId, ticker: ctx.ticker },
    orderBy: [{ updatedAt: "desc" }],
  });
  const tkEnc = encodeURIComponent(ctx.ticker);
  const savedIds = [
    ...new Set(
      documents
        .map((d) => d.savedDocumentRefId)
        .filter((ref): ref is string => typeof ref === "string" && ref.startsWith("user_saved:"))
        .map((ref) => ref.slice("user_saved:".length))
    ),
  ];
  const savedRows =
    savedIds.length > 0
      ? await prisma.userSavedDocument.findMany({
          where: { userId: ctx.userId, ticker: ctx.ticker, id: { in: savedIds } },
          select: { id: true, filename: true },
        })
      : [];
  const savedOpenById = new Map(savedRows.map((r) => [r.id, r.filename]));

  const payload = documents.map((r) => {
    const base = serCreditRow(r as unknown as Record<string, unknown>);
    const ref = r.savedDocumentRefId;
    let documentOpenUrl: string | null = null;
    if (typeof r.secUrl === "string" && r.secUrl.startsWith("https://www.sec.gov/")) {
      documentOpenUrl = r.secUrl;
    } else if (typeof ref === "string") {
      if (ref.startsWith("user_saved:")) {
        const sid = ref.slice("user_saved:".length);
        const fn = savedOpenById.get(sid);
        if (fn) documentOpenUrl = `/api/saved-documents/${tkEnc}?file=${encodeURIComponent(fn)}`;
      } else if (ref.startsWith("public_records:")) {
        const pid = ref.slice("public_records:".length);
        documentOpenUrl = `/api/companies/${tkEnc}/public-records/documents/${encodeURIComponent(pid)}`;
      } else if (ref.startsWith("credit_workspace:")) {
        const fn = ref.slice("credit_workspace:".length);
        documentOpenUrl = `/api/credit-agreements-files/${tkEnc}?file=${encodeURIComponent(fn)}&inline=1`;
      }
    }
    return { ...base, documentOpenUrl };
  });

  return NextResponse.json({ documents: payload });
}

export async function POST(req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker: raw } = await params;
  const ctx = await requireUserTicker(raw);
  if ("error" in ctx) return ctx.error;
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const documentTitle = typeof body.documentTitle === "string" ? body.documentTitle.trim() : "";
  if (!documentTitle) return NextResponse.json({ error: "documentTitle required" }, { status: 400 });
  const secUrlRaw = typeof body.secUrl === "string" ? body.secUrl.trim() : "";
  const savedRefRaw = typeof body.savedDocumentRefId === "string" ? body.savedDocumentRefId.trim() : "";
  if (!savedRefRaw && !secUrlRaw) {
    return NextResponse.json({ error: "savedDocumentRefId or secUrl required" }, { status: 400 });
  }
  const row = await prisma.creditDocumentSource.create({
    data: {
      userId: ctx.userId,
      ticker: ctx.ticker,
      documentTitle,
      documentType: (typeof body.documentType === "string"
        ? body.documentType
        : inferCreditDocumentTitleType(documentTitle)) as CreditDocSourceDocumentType,
      filingType:
        typeof body.filingType === "string"
          ? (body.filingType as CreditDocSourceFilingKind)
          : "saved_document",
      filingDate:
        typeof body.filingDate === "string" && body.filingDate ? new Date(String(body.filingDate)) : undefined,
      accessionNumber: typeof body.accessionNumber === "string" ? body.accessionNumber : undefined,
      exhibitNumber: typeof body.exhibitNumber === "string" ? body.exhibitNumber : undefined,
      secUrl: secUrlRaw || undefined,
      sourceUrl: typeof body.sourceUrl === "string" ? body.sourceUrl : undefined,
      localFileUrl: typeof body.localFileUrl === "string" ? body.localFileUrl : undefined,
      savedDocumentRefId: savedRefRaw || undefined,
      notes: typeof body.notes === "string" ? body.notes : undefined,
    },
  });
  return NextResponse.json({ document: serCreditRow(row as unknown as Record<string, unknown>) });
}
