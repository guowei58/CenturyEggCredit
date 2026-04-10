import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildHistoricalModelZipFromSavedXbrl } from "@/lib/xbrl-saved-history/assembleFromSavedWorkbooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * POST — Build a 10-year (max) annual historical model from **saved** SEC-XBRL as-presented Excel files
 * in Saved Documents (no SEC fetch). Returns a ZIP with CSVs + assembly_log.md + summary JSON.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  const sym = (ticker ?? "").trim().toUpperCase();
  if (!sym) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const result = await buildHistoricalModelZipFromSavedXbrl(userId, sym);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const safe = sym.replace(/[^\w-]+/g, "_");
  return new NextResponse(new Uint8Array(result.zipBuffer), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safe}_SEC-XBRL-historical-model.zip"`,
      "X-Ceg-Fiscal-Years": result.summary.fiscalYearsIncluded.join(","),
      "X-Ceg-Files-Used": String(result.summary.filesUsed.length),
    },
  });
}
