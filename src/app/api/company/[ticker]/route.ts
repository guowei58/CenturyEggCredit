import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";
import { readPrivateWorkspaceMeta, writePrivateWorkspaceMeta } from "@/lib/private-workspace-meta";
import { getCompanyProfile } from "@/lib/sec-edgar";
import { sanitizeTicker } from "@/lib/saved-ticker-data";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker } = await params;
  if (!ticker || typeof ticker !== "string") {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }
  const sym = sanitizeTicker(ticker.trim()) ?? ticker.trim().toUpperCase();
  try {
    if (isPrivateWorkspaceKey(sym)) {
      const session = await auth();
      let storedName: string | null = null;
      if (session?.user?.id) {
        const meta = await readPrivateWorkspaceMeta(session.user.id, sym);
        if (meta) storedName = meta.displayName;
      }
      const name = privateWorkspaceDisplayName(sym, storedName);
      if (session?.user?.id && !storedName && name !== "Private company") {
        await writePrivateWorkspaceMeta(session.user.id, sym, name);
      }
      return NextResponse.json({ name, isPrivate: true, ticker: sym });
    }

    const profile = await getCompanyProfile(sym);
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
