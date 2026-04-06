import { NextResponse } from "next/server";
import { fetchFromEdgarBridge } from "@/lib/edgartools-bridge";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
): Promise<NextResponse> {
  const { ticker } = await params;
  const safe = ticker?.trim();
  if (!safe) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  const u = new URL(request.url);
  const q = u.searchParams.toString();
  const path = `/company/${encodeURIComponent(safe)}/filings${q ? `?${q}` : ""}`;

  try {
    const res = await fetchFromEdgarBridge(path);
    const text = await res.text();
    try {
      return NextResponse.json(JSON.parse(text) as object, { status: res.status });
    } catch {
      return new NextResponse(text, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("content-type") ?? "text/plain; charset=utf-8" },
      });
    }
  } catch (e) {
    return NextResponse.json(
      {
        error: "Could not reach EdgarTools bridge",
        detail: e instanceof Error ? e.message : String(e),
      },
      { status: 503 }
    );
  }
}
