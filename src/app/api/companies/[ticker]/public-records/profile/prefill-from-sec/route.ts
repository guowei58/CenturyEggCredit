import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { buildPublicRecordsProfileFromSec } from "@/lib/buildPublicRecordsProfileFromSec";

export const dynamic = "force-dynamic";

/**
 * Returns structured hints from SEC submissions + latest 10-K (does not persist).
 * Client merges into profile draft; user saves explicitly.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker: raw } = await params;
  const ticker = raw?.trim().toUpperCase() ?? "";
  if (!ticker) return NextResponse.json({ error: "Ticker required" }, { status: 400 });

  const result = await buildPublicRecordsProfileFromSec(ticker, userId);
  if (!result.ok) {
    return NextResponse.json({ error: result.message }, { status: 422 });
  }

  return NextResponse.json({
    prefill: result.prefill,
    disclaimer:
      "Automated extraction from SEC JSON and 10-K text is approximate. Verify registrant name, incorporation state, address, and subsidiaries against official filings before relying on search coverage.",
  });
}
