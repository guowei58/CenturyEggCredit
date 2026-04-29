import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "Missing file" }, { status: 400 });
  }

  const filename =
    typeof (file as File).name === "string" && (file as File).name ? (file as File).name : "upload.bin";
  const contentType = typeof (file as File).type === "string" ? (file as File).type || null : null;
  const buf = Buffer.from(await file.arrayBuffer());

  const doc = await prisma.publicRecordsDocument.create({
    data: {
      userId,
      ticker,
      filename,
      contentType,
      body: buf,
    },
    select: {
      id: true,
      filename: true,
      contentType: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ document: doc });
}
