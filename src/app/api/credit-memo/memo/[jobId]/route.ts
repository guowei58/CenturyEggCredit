import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { getJob } from "@/lib/creditMemo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { jobId: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = params.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  const job = await getJob(userId, jobId);
  if (!job) return NextResponse.json({ error: "Memo job not found" }, { status: 404 });
  return NextResponse.json({ job });
}
