import { NextResponse } from "next/server";
import { getFilingsByCik, normalizeCikInput } from "@/lib/sec-edgar";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cik: string }> }
): Promise<NextResponse> {
  const { cik: raw } = await params;
  const cik = normalizeCikInput(raw ?? "");
  if (!cik) {
    return NextResponse.json({ error: "Invalid CIK" }, { status: 400 });
  }
  try {
    const result = await getFilingsByCik(cik);
    if (!result) {
      return NextResponse.json(
        { error: "No SEC submissions found for this CIK (check the number or try another entity)." },
        { status: 404 }
      );
    }
    return NextResponse.json(result, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
      },
    });
  } catch (e) {
    console.error("SEC filings by CIK error:", e);
    return NextResponse.json({ error: "Failed to fetch SEC filings" }, { status: 500 });
  }
}
