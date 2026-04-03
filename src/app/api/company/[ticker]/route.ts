import { NextResponse } from "next/server";
import { getCompanyProfile } from "@/lib/sec-edgar";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  if (!ticker || typeof ticker !== "string") {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  try {
    const profile = await getCompanyProfile(ticker.trim());
    if (!profile) {
      return NextResponse.json(
        { error: "Company not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(profile);
  } catch (e) {
    console.error("SEC company profile error:", e);
    return NextResponse.json(
      { error: "Failed to fetch company profile" },
      { status: 500 }
    );
  }
}
