import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { resolveCompanyWorkspace } from "@/lib/company-workspace-resolver";
import { writePrivateWorkspaceMeta } from "@/lib/private-workspace-meta";

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

    if (resolved.isPrivate) {
      const session = await auth();
      if (session?.user?.id && resolved.companyName.trim()) {
        const wrote = await writePrivateWorkspaceMeta(
          session.user.id,
          resolved.workspaceKey,
          resolved.companyName
        );
        if (!wrote) console.warn("private workspace meta write failed for", resolved.workspaceKey);
      }
    }

    return NextResponse.json(resolved);
  } catch (e) {
    console.error("company resolve error:", e);
    return NextResponse.json({ error: "Failed to resolve company" }, { status: 500 });
  }
}
