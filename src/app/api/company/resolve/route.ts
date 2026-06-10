import { NextResponse } from "next/server";
import { resolveCompanyWorkspace } from "@/lib/company-workspace-resolver";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<NextResponse> {
  const q = new URL(request.url).searchParams.get("q")?.trim() ?? "";
  if (!q) {
    return NextResponse.json({ error: "Query required" }, { status: 400 });
  }
  if (q.length > 120) {
    return NextResponse.json({ error: "Query too long" }, { status: 400 });
  }

  try {
    const resolved = await resolveCompanyWorkspace(q);
    if ("error" in resolved) {
      return NextResponse.json({ error: resolved.error }, { status: 404 });
    }
    return NextResponse.json(resolved);
  } catch (e) {
    console.error("company resolve error:", e);
    return NextResponse.json({ error: "Failed to resolve company" }, { status: 500 });
  }
}
