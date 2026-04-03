import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  deleteCreditAgreementsFile,
  getCreditAgreementsFileBuffer,
  listCreditAgreementsFiles,
  saveCreditAgreementsFile,
} from "@/lib/credit-agreements-files";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file");

  if (file) {
    const found = await getCreditAgreementsFileBuffer(userId, ticker, file);
    if (!found) return NextResponse.json({ error: "File not found" }, { status: 404 });
    const contentType = found.item?.contentType || "application/octet-stream";
    const originalName = found.item?.originalName || file;
    return new NextResponse(new Uint8Array(found.buf), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${originalName.replace(/"/g, "")}"`,
      },
    });
  }

  const items = await listCreditAgreementsFiles(userId, ticker);
  if (!items) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  return NextResponse.json({ items });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const files = formData.getAll("file").filter((f) => f instanceof Blob) as Blob[];
  if (!files.length) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const items = [];
  for (let i = 0; i < files.length; i++) {
    const blob = files[i];
    const filenameOverride = formData.getAll("filename")?.[i];
    const originalName =
      typeof filenameOverride === "string" && filenameOverride.trim().length > 0
        ? filenameOverride.trim()
        : (blob as unknown as { name?: string }).name || `credit-document-${i + 1}`;

    const arrayBuffer = await blob.arrayBuffer();
    const buf = Buffer.from(arrayBuffer);
    const result = await saveCreditAgreementsFile({
      userId,
      ticker,
      fileBuffer: buf,
      originalName,
      contentType: blob.type || "application/octet-stream",
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    items.push(result.item);
  }

  return NextResponse.json({ ok: true, items });
}

export async function DELETE(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const url = new URL(request.url);
  const file = url.searchParams.get("file");
  if (!file) return NextResponse.json({ error: "Missing file" }, { status: 400 });

  const result = await deleteCreditAgreementsFile({ userId, ticker, filename: file });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
