import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import {
  buildWorkProductPromptPackage,
  type WorkProductPromptKind,
} from "@/lib/work-product-prompt-build";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const KINDS = new Set<WorkProductPromptKind>([
  "kpi",
  "lme",
  "forensic",
  "recommendation",
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
]);

export async function POST(
  request: Request,
  { params }: { params: Promise<{ kind: string; ticker: string }> }
) {
  const { kind: kindRaw, ticker } = await params;
  const kind = kindRaw?.trim().toLowerCase() as WorkProductPromptKind;
  if (!KINDS.has(kind)) {
    return NextResponse.json({ error: "Invalid work product kind" }, { status: 400 });
  }

  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to build the context window." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;

  let companyName = "";
  try {
    const body = (await request.json()) as { companyName?: unknown };
    companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  } catch {
    /* optional body */
  }

  const result = await buildWorkProductPromptPackage({
    kind,
    ticker: sym,
    userId,
    apiKeys: bundle,
    companyName: companyName || undefined,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const pkg = result.package;
  return NextResponse.json({
    ok: true,
    kind: pkg.kind,
    ticker: pkg.ticker,
    systemPrompt: pkg.systemPrompt,
    userPrompt: pkg.userPrompt,
    copyPrompt: pkg.copyPrompt,
    retrievalUsed: pkg.retrievalUsed,
    packingStats: pkg.packingStats,
    userMessageBreakdown: pkg.userMessageBreakdown,
    sourceFingerprint: pkg.sourceFingerprint,
    systemChars: pkg.systemPrompt.length,
    userChars: pkg.userPrompt.length,
    copyChars: pkg.copyPrompt.length,
  });
}
