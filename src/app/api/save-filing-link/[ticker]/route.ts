import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { isFilingsTabUrlAllowed } from "@/lib/filing-link-allowlist";
import { saveDocumentFromUrl } from "@/lib/saved-documents";

export const dynamic = "force-dynamic";
/** Save + fetch + PDF can exceed default 10s on Vercel Hobby; raise on paid plans as needed. */
export const maxDuration = 60;

/**
 * POST { url } — fetch URL server-side and store native format in Postgres (Saved Documents pipeline).
 * URL host must be on the SEC/FCC/USPTO allowlist. Requires session.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { ticker } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const b = body as { url?: unknown };
  const url = typeof b.url === "string" ? b.url.trim() : "";
  if (!url) return NextResponse.json({ error: "Missing url" }, { status: 400 });

  if (!isFilingsTabUrlAllowed(url)) {
    return NextResponse.json(
      { error: "URL host is not allowed for this save action (SEC, FCC, USPTO, or patents.google.com only)." },
      { status: 400 }
    );
  }

  try {
    const result = await saveDocumentFromUrl(userId, ticker, url);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    return NextResponse.json({ ok: true, item: result.item });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unexpected save failure";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
