import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getSubsidiaryHintsForTicker } from "@/lib/subsidiary-hints";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const safe = ticker?.trim();
  if (!safe) {
    return NextResponse.json({ ok: false, message: "Ticker required" }, { status: 400 });
  }

  try {
    const session = await auth();
    const result = await getSubsidiaryHintsForTicker(safe, session?.user?.id);
    if (!result.ok) {
      return NextResponse.json(result, { status: 200 });
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("subsidiary-hints error:", e);
    return NextResponse.json(
      { ok: false, message: "Failed to load subsidiary hints." },
      { status: 500 }
    );
  }
}
