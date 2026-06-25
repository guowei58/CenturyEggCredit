import { NextResponse } from "next/server";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { requireRiskChecklistAccess, requireRiskOverrideAccess } from "@/lib/risk-checklist/api-auth";
import {
  applyManualOverride,
  compareAssessments,
  completeIssuerAssessment,
  duplicatePriorAssessment,
  loadRiskChecklistWorkspace,
  reopenIssuerAssessment,
  saveDaggerFlags,
  saveRiskAnswers,
  type AnswerInput,
  type DaggerInput,
} from "@/lib/risk-checklist/store";

export const dynamic = "force-dynamic";

function riskChecklistErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : "Request failed";
  if (message.includes("Invalid `prisma.") || message.includes("prisma.")) {
    return "Risk checklist save failed. Please refresh the page and try again.";
  }
  return message;
}

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  try {
    const workspace = await loadRiskChecklistWorkspace(access.userId, sym);
    return NextResponse.json(workspace);
  } catch (e) {
    console.error("[risk-checklist] GET failed:", e);
    const message = riskChecklistErrorMessage(e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

type PutBody = {
  action?: string;
  answers?: AnswerInput[];
  daggers?: DaggerInput[];
  sourceAssessmentId?: string;
  manualOverride?: {
    overrideScore: number;
    overrideClassification?: string | null;
    reason: string;
    reviewDate: string;
  };
};

export async function PUT(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const action = body.action ?? "save_draft";

  try {
    if (action === "save_draft" && body.answers) {
      const workspace = await saveRiskAnswers(access.userId, sym, body.answers, access.userId);
      return NextResponse.json(workspace);
    }
    if (action === "save_daggers" && body.daggers) {
      const workspace = await saveDaggerFlags(access.userId, sym, body.daggers, access.userId);
      return NextResponse.json(workspace);
    }
    if (action === "complete") {
      const workspace = await completeIssuerAssessment(access.userId, sym, access.userId);
      return NextResponse.json(workspace);
    }
    if (action === "reopen") {
      const workspace = await reopenIssuerAssessment(access.userId, sym, access.userId);
      return NextResponse.json(workspace);
    }
    if (action === "duplicate" && body.sourceAssessmentId) {
      const workspace = await duplicatePriorAssessment(
        access.userId,
        sym,
        body.sourceAssessmentId,
        access.userId
      );
      return NextResponse.json(workspace);
    }
    if (action === "manual_override" && body.manualOverride) {
      const overrideAccess = await requireRiskOverrideAccess();
      if ("error" in overrideAccess) return overrideAccess.error;
      const workspace = await applyManualOverride(
        access.userId,
        sym,
        body.manualOverride,
        access.userId
      );
      return NextResponse.json(workspace);
    }
    return NextResponse.json({ error: "Unknown action or missing payload" }, { status: 400 });
  } catch (e) {
    console.error("[risk-checklist] PUT failed:", e);
    return NextResponse.json({ error: riskChecklistErrorMessage(e) }, { status: 400 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  const url = new URL(request.url);
  const compareA = url.searchParams.get("compareA");
  const compareB = url.searchParams.get("compareB");
  if (compareA && compareB) {
    const comparison = await compareAssessments(access.userId, sym, compareA, compareB);
    return NextResponse.json(comparison);
  }

  return NextResponse.json({ error: "Unsupported request" }, { status: 400 });
}
