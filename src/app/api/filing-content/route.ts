import { NextResponse } from "next/server";

import { oreoUserAgent } from "@/lib/branding";

const USER_AGENT = oreoUserAgent("filing content");

/**
 * Proxy SEC filing document content so the client can render it in-app
 * and support text search. Only allows sec.gov URLs.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url || typeof url !== "string") {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return NextResponse.json({ error: "Invalid url" }, { status: 400 });
  }
  if (parsed.origin !== "https://www.sec.gov" && parsed.origin !== "http://www.sec.gov") {
    return NextResponse.json({ error: "Only sec.gov URLs allowed" }, { status: 400 });
  }
  try {
    const res = await fetch(parsed.toString(), {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `SEC returned ${res.status}` },
        { status: res.status === 404 ? 404 : 502 }
      );
    }
    const text = await res.text();
    return new NextResponse(text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
      },
    });
  } catch (e) {
    console.error("Filing content fetch error:", e);
    return NextResponse.json(
      { error: "Failed to fetch document" },
      { status: 502 }
    );
  }
}
