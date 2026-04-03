import { NextResponse } from "next/server";
import { getLatest10KBusinessProfile } from "@/lib/sec-10k";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  const safeTicker = typeof ticker === "string" ? ticker.trim().toUpperCase() : "";
  if (!safeTicker) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  try {
    const profile = await getLatest10KBusinessProfile(safeTicker);
    if (!profile) {
      return NextResponse.json(
        { error: "No 10-K available for this company." },
        { status: 404 }
      );
    }
    return NextResponse.json(profile, {
      headers: {
        "Cache-Control": "public, max-age=0, s-maxage=300",
      },
    });
  } catch (e) {
    console.error("business-profile error:", e);
    return NextResponse.json(
      { error: "Failed to fetch or parse 10-K." },
      { status: 500 }
    );
  }
}

