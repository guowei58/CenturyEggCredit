import { NextResponse } from "next/server";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { resolveProvider } from "@/lib/ai-provider";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { requireRiskChecklistAccess } from "@/lib/risk-checklist/api-auth";
import { runRiskAiAnalyzer } from "@/lib/risk-checklist/run-risk-ai-analyzer";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const access = await requireRiskChecklistAccess();
  if ("error" in access) return access.error;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });

  let body: {
    provider?: unknown;
    companyName?: unknown;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    // optional body
  }

  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to run AI Risk Analyzer." }, { status: 401 });
  }

  const provider = resolveProvider(body.provider);
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : undefined;

  const result = await runRiskAiAnalyzer({
    userId: access.userId,
    ticker: sym,
    performedBy: access.userId,
    provider,
    models: body,
    apiKeys: llmAuth.ctx.bundle,
    temperature: llmAuth.ctx.llmTemperature,
    companyName,
  });

  if (!result.ok) {
    const msg = result.error;
    const status =
      msg.includes("No saved tab responses") || msg.includes("cannot be edited") || msg.includes("No editable")
        ? 400
        : msg.includes("API key")
          ? 503
          : 502;
    return NextResponse.json({ error: msg }, { status });
  }

  return NextResponse.json({
    workspace: result.workspace,
    sourceCount: result.sourceCount,
    sourcesIncluded: result.sourcesIncluded,
    totalSourceChars: result.totalSourceChars,
    answeredCount: result.answeredCount,
    questionCount: result.questionCount,
  });
}
