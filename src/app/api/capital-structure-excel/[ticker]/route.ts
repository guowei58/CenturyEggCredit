import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getCapitalStructureExcelBuffer,
  listCapitalStructureExcels,
  saveCapitalStructureExcelFile,
} from "@/lib/capital-structure-excel";

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
    const buf = await getCapitalStructureExcelBuffer(userId, ticker, file);
    if (!buf) return NextResponse.json({ error: "File not found" }, { status: 404 });
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `inline; filename="${file}"`,
      },
    });
  }

  const items = await listCapitalStructureExcels(userId, ticker);
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

  const file = formData.get("file");
  if (!file || !(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const blob = file as Blob;
  const originalName = (formData.get("filename") as string | null) ?? "capital-structure-input.xlsx";
  const arrayBuffer = await blob.arrayBuffer();
  const buf = Buffer.from(arrayBuffer);

  const result = await saveCapitalStructureExcelFile({
    userId,
    ticker,
    fileBuffer: buf,
    originalName,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ ok: true, item: result.item });
}
