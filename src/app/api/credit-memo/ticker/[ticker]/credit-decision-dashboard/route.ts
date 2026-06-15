import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import {
  pickBestConfiguredCreditDashboardProvider,
  runCreditDecisionDashboardGeneration,
} from "@/lib/creditMemo/generateCreditDecisionDashboard";
import type { CreditDecisionDashboardInputs } from "@/lib/creditMemo/creditDecisionDashboardTypes";
import { memoOnlyReferenceStubProject } from "@/lib/creditMemo/memoOnlyReferenceProject";
import { appendJob, clearIngestCorpusAfterWorkProduct, getLatestProjectForTicker, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import { creditMemoPrimaryModelId, resolveCreditDecisionDashboardModels } from "@/lib/ai-model-from-request";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

function parseInputs(body: Record<string, unknown>, fallbackTicker: string): CreditDecisionDashboardInputs {
  const str = (k: string) => (typeof body[k] === "string" ? body[k].trim() : "");
  return {
    companyName: str("companyName"),
    ticker: str("ticker") || fallbackTicker,
    securityAnalyzed: str("securityAnalyzed"),
    currentPrice: str("currentPrice"),
    currentYieldSpread: str("currentYieldSpread"),
    maturity: str("maturity"),
    coupon: str("coupon"),
    securityRanking: str("securityRanking"),
    analystView: str("analystView"),
    analystNotes: str("analystNotes"),
  };
}

export async function POST(req: Request, { params }: { params: { ticker: string } }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, bundle, llmTemperature } = llmAuth.ctx;

  const sym = sanitizeWorkspaceKey(params.ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid workspace key" }, { status: 400 });

  const project =
    (await getLatestProjectForTicker(userId, sym)) ?? memoOnlyReferenceStubProject(sym);

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const inputs = parseInputs(body, sym);
  const provider = pickBestConfiguredCreditDashboardProvider(bundle);
  if (!provider) {
    return NextResponse.json({ error: "No LLM API key configured for this account." }, { status: 400 });
  }

  const models = resolveCreditDecisionDashboardModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const jobId = newJobId();
  const memoTitle = `${project.ticker} — Credit Decision Dashboard`;
  const targetWords = 8_000;

  const result = await runCreditDecisionDashboardGeneration({
    userId,
    project,
    inputs,
    provider,
    models,
    apiKeys: bundle,
    temperature: llmTemperature,
  });

  if (!result.ok) {
    const failed = memoJobFromRun(jobId, project, targetWords, memoTitle, provider, null, null, null, result.error);
    await appendJob(userId, failed);
    return NextResponse.json({ ok: false, jobId, error: result.error }, { status: 502 });
  }

  const done = memoJobFromRun(
    jobId,
    project,
    targetWords,
    memoTitle,
    provider,
    null,
    result.rawJson,
    result.sourcePack,
    null
  );
  await appendJob(userId, done);

  try {
    await writeSavedContent(project.ticker, "credit-decision-dashboard-latest", result.rawJson, userId);
    await writeSavedContent(
      project.ticker,
      "credit-decision-dashboard-latest-source-pack",
      result.sourcePack,
      userId
    );
    await writeSavedContent(
      project.ticker,
      "credit-decision-dashboard-inputs",
      JSON.stringify(inputs, null, 2),
      userId
    );
    await writeSavedContent(
      project.ticker,
      "credit-decision-dashboard-latest-meta",
      JSON.stringify(
        {
          jobId,
          memoTitle,
          provider,
          llmModel: llmModelUsed,
          createdAt: done.createdAt,
          projectId: project.id,
          inputs,
        },
        null,
        2
      ),
      userId
    );
  } catch {
    /* ignore */
  }

  try {
    await clearIngestCorpusAfterWorkProduct(userId, project.id);
  } catch {
    /* best-effort */
  }

  return NextResponse.json({
    ok: true,
    jobId,
    dashboard: result.dashboard,
    provider,
    llmModelUsed,
  });
}
