import { NextResponse } from "next/server";
import { fetchFromEdgarBridge } from "@/lib/edgartools-bridge";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const u = new URL(request.url);
  const accession = u.searchParams.get("accession")?.trim();
  if (!accession) {
    return NextResponse.json({ error: "accession query parameter required" }, { status: 400 });
  }

  const copy = new URLSearchParams(u.searchParams);
  copy.set("accession", accession);
  const path = `/filing/bundle?${copy.toString()}`;

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
