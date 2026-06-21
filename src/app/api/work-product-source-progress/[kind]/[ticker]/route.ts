import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  getWorkProductSourceProgress,
  workProductSourceProgressKey,
} from "@/lib/work-product-source-progress";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind, ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!kind?.trim() || !sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid kind or ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;
  if (!userId) {
    return NextResponse.json({ progress: null }, { status: 200 });
  }

  const key = workProductSourceProgressKey(userId, kind, sym);
  const progress = getWorkProductSourceProgress(key);

  return NextResponse.json({
    progress: progress
      ? {
          phase: progress.phase,
          detail: progress.detail,
          done: progress.done,
          total: progress.total,
        }
      : null,
  });
}
