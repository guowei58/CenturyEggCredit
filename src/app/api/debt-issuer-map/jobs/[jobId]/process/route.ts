import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(_request: Request, { params }: { params: Promise<{ jobId: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { jobId } = await params;
  if (!jobId) return NextResponse.json({ error: "jobId required" }, { status: 400 });

  const job = await prisma.debtIssuerMapJob.findFirst({
    where: { id: jobId, userId },
  });
  if (!job) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (job.status !== "pending" && job.status !== "failed") {
    return NextResponse.json({ error: "Job already started or completed" }, { status: 409 });
  }

  await prisma.debtIssuerMapJob.update({
    where: { id: jobId },
    data: { status: "pending", errorMessage: null, completedAt: null, updatedAt: new Date() },
  });

  const { runDebtIssuerMapJob } = await import("@/lib/debt-map/runJob");
  try {
    await runDebtIssuerMapJob(jobId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Job failed";
    await prisma.debtIssuerMapJob.update({
      where: { id: jobId },
      data: { status: "failed", errorMessage: msg, completedAt: new Date() },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  const done = await prisma.debtIssuerMapJob.findUnique({ where: { id: jobId } });
  return NextResponse.json({ ok: true, status: done?.status });
}
