import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const job = await prisma.debtIssuerMapJob.findFirst({
    where: { id: jobId, userId },
    include: {
      sourceDocuments: { orderBy: { filingDate: "desc" } },
      legalEntities: { orderBy: { legalName: "asc" } },
      instruments: {
        include: {
          sourceDocument: true,
          roles: { include: { legalEntity: true } },
        },
        orderBy: { instrumentName: "asc" },
      },
      footnoteItems: true,
      redFlags: { orderBy: [{ severity: "desc" }, { createdAt: "asc" }] },
    },
  });

  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({ job });
}
