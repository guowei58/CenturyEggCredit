import { NextResponse } from "next/server";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { requireRiskChecklistAccess } from "@/lib/risk-checklist/api-auth";
import { createSecurityInstrument, loadSecurityAssessmentWorkspace } from "@/lib/risk-checklist/store";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const url = new URL(_request.url);
  const securityId = url.searchParams.get("securityId");
  if (!securityId) {
    return NextResponse.json({ error: "securityId required" }, { status: 400 });
  }

  const workspace = await loadSecurityAssessmentWorkspace(access.userId, sym, securityId);
  return NextResponse.json(workspace);
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: {
    name?: string;
    cusip?: string | null;
    isin?: string | null;
    priority?: string | null;
    lienLevel?: string | null;
    maturityDate?: string | null;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const security = await createSecurityInstrument(access.userId, sym, {
    name: body.name.trim(),
    cusip: body.cusip,
    isin: body.isin,
    priority: body.priority,
    lienLevel: body.lienLevel,
    maturityDate: body.maturityDate,
  });

  return NextResponse.json({ security });
}
