import { NextResponse } from "next/server";
import { getRelatedSecFilersForTicker } from "@/lib/sec-related-filers";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const safe = ticker?.trim();
  if (!safe) {
    return NextResponse.json({ ok: false, message: "Ticker required" }, { status: 400 });
  }

  try {
    const result = await getRelatedSecFilersForTicker(safe);
    if (!result.ok) {
      const notFound = result.message.includes("Company not found");
      return NextResponse.json(result, { status: notFound ? 404 : 500 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("related-filers error:", e);
    return NextResponse.json(
      { ok: false, message: "Failed to load related SEC registrants." },
      { status: 500 }
    );
  }
}
