import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getLatest10KFilingMeta } from "@/lib/sec-10k";

export const dynamic = "force-dynamic";

/** Latest Form 10-K from SEC EDGAR Data API (`data.sec.gov` submissions + Archives links)—not from user Saved Documents. */
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const tenK = await getLatest10KFilingMeta(ticker);
  return NextResponse.json({ tenK });
}
