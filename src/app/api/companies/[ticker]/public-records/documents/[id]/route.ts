import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

function contentTypeForFilename(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  switch (ext) {
    case ".pdf":
      return "application/pdf";
    case ".html":
    case ".htm":
      return "text/html; charset=utf-8";
    case ".txt":
    case ".md":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string; id: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: rawTicker, id } = await params;
  const ticker = rawTicker?.trim().toUpperCase() ?? "";
  if (!ticker || !id?.trim()) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const doc = await prisma.publicRecordsDocument.findFirst({
    where: { id: id.trim(), userId, ticker },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const ct = doc.contentType?.trim() || contentTypeForFilename(doc.filename);
  const safeName = doc.filename.replace(/"/g, "");
  return new NextResponse(new Uint8Array(doc.body), {
    headers: {
      "Content-Type": ct,
      "Content-Disposition": `inline; filename="${safeName}"`,
    },
  });
}
