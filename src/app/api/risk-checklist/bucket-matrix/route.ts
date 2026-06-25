import { NextResponse } from "next/server";
import { requireRiskChecklistAccess } from "@/lib/risk-checklist/api-auth";
import { getRiskBucketQuestionMatrix } from "@/lib/risk-checklist/store";
import { ISSUER_RISK_BUCKET_KEYS } from "@/lib/risk-checklist/seed-data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const category = new URL(request.url).searchParams.get("category")?.trim();
  if (!category || !(ISSUER_RISK_BUCKET_KEYS as readonly string[]).includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }

  const matrix = await getRiskBucketQuestionMatrix(
    access.userId,
    category as (typeof ISSUER_RISK_BUCKET_KEYS)[number]
  );
  return NextResponse.json(matrix);
}
