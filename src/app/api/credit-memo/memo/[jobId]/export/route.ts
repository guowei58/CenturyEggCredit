import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { downloadFilename, memoToDocx, memoToHtml } from "@/lib/creditMemo/exportMemo";
import { getJob } from "@/lib/creditMemo/store";
import { readSavedContent } from "@/lib/saved-content-hybrid";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { jobId: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const jobId = params.jobId?.trim();
  if (!jobId) return NextResponse.json({ error: "Missing job id" }, { status: 400 });
  const job = await getJob(userId, jobId);
  if (!job) return NextResponse.json({ error: "Memo job not found" }, { status: 404 });
  if (!job.markdown) return NextResponse.json({ error: "Memo not ready or generation failed" }, { status: 400 });

  const { searchParams } = new URL(req.url);
  const format = (searchParams.get("format") || "md").toLowerCase();

  if (format === "source-pack" || format === "sourcepack" || format === "sources") {
    const sp =
      job.sourcePack ??
      (await readSavedContent(job.ticker, "ai-credit-memo-latest-source-pack", userId)) ??
      "";
    return new NextResponse(sp, {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="credit-memo_source-pack_${job.ticker}_${job.id.slice(0, 8)}.txt"`,
      },
    });
  }

  if (format === "docx") {
    const buf = await memoToDocx(job.markdown, job.memoTitle);
    const body = new Uint8Array(buf);
    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${downloadFilename(job, "docx")}"`,
      },
    });
  }

  if (format === "html") {
    const html = memoToHtml(job.markdown, job.memoTitle);
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${downloadFilename(job, "html")}"`,
      },
    });
  }

  return new NextResponse(job.markdown, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="${downloadFilename(job, "md")}"`,
    },
  });
}
