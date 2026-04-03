import { NextResponse } from "next/server";
import { getFilingsByTicker } from "@/lib/sec-edgar";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  if (!ticker || typeof ticker !== "string") {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  try {
    const result = await getFilingsByTicker(ticker.trim());
    if (!result) {
      return NextResponse.json(
        { error: "Company not found or no filings" },
        { status: 404 }
      );
    }
    return NextResponse.json(result);
  } catch (e) {
    console.error("SEC filings error:", e);
    return NextResponse.json(
      { error: "Failed to fetch SEC filings" },
      { status: 500 }
    );
  }
}
