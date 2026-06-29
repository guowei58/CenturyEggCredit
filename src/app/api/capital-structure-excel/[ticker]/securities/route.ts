import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import {
  listCapitalStructureSecurities,
  syncCapitalStructureSecuritiesFromExcel,
} from "@/lib/capital-structure-securities";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const url = new URL(_request.url);
  const confirmedOnly = url.searchParams.get("confirmed") === "1";

  const securities = await listCapitalStructureSecurities(userId, sym, { confirmedOnly });
  if (!securities) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  return NextResponse.json({ securities, confirmedCount: securities.filter((s) => s.isConfirmed).length });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: { excelFilename?: string | null } = {};
  try {
    const text = await request.text();
    if (text.trim()) body = JSON.parse(text) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const result = await syncCapitalStructureSecuritiesFromExcel(userId, sym, body.excelFilename);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    securities: result.securities,
    sheetName: result.sheetName,
    sourceExcelFile: result.sourceExcelFile,
    parsedCount: result.parsedCount,
  });
}
