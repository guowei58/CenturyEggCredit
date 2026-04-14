import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { downloadFilenameForTickerBody, memoToDocx, memoToHtml } from "@/lib/creditMemo/exportMemo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportFormat = "docx" | "md" | "markdown" | "html";

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Expected JSON object" }, { status: 400 });
  }
  const o = body as Record<string, unknown>;
  const markdown = typeof o.markdown === "string" ? o.markdown : "";
  if (!markdown.trim()) {
    return NextResponse.json({ error: "Missing or empty markdown" }, { status: 400 });
  }

  const formatRaw = typeof o.format === "string" ? o.format.trim().toLowerCase() : "docx";
  const format = formatRaw as ExportFormat;
  const ticker = typeof o.ticker === "string" && o.ticker.trim() ? o.ticker.trim().toUpperCase() : "MEMO";
  const memoTitle =
    typeof o.memoTitle === "string" && o.memoTitle.trim() ? o.memoTitle.trim() : `${ticker} — Credit Memo`;

  if (format === "docx") {
    const buf = await memoToDocx(markdown, memoTitle);
    const name = downloadFilenameForTickerBody(ticker, "docx");
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }

  if (format === "md" || format === "markdown") {
    const name = downloadFilenameForTickerBody(ticker, "md");
    return new NextResponse(markdown, {
      status: 200,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }

  if (format === "html") {
    const html = memoToHtml(markdown, memoTitle);
    const name = downloadFilenameForTickerBody(ticker, "html");
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
      },
    });
  }

  return NextResponse.json({ error: "Unsupported format (use docx, md, or html)" }, { status: 400 });
}
