import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import {
  pickBestConfiguredDumbassProvider,
  runHowToLookLikeADumbassGeneration,
} from "@/lib/creditMemo/generateHowToLookLikeADumbass";
import { memoOnlyReferenceStubProject } from "@/lib/creditMemo/memoOnlyReferenceProject";
import { appendJob, clearIngestCorpusAfterWorkProduct, getLatestProjectForTicker, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import { creditMemoPrimaryModelId, resolveHowToLookLikeADumbassModels } from "@/lib/ai-model-from-request";
import { sanitizeWorkspaceKey } from "@/lib/company-workspace-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: { ticker: string } }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, bundle, llmTemperature } = llmAuth.ctx;

  const sym = sanitizeWorkspaceKey(params.ticker ?? "");
  if (!sym) return NextResponse.json({ error: "Invalid workspace key" }, { status: 400 });

  const project =
    (await getLatestProjectForTicker(userId, sym)) ?? memoOnlyReferenceStubProject(sym);

  let body: {
    companyName?: string;
    targetSecurity?: string;
    tradingPrice?: string;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    body = {};
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const targetSecurity = typeof body.targetSecurity === "string" ? body.targetSecurity.trim() : "";
  const tradingPrice = typeof body.tradingPrice === "string" ? body.tradingPrice.trim() : "";
  const provider = pickBestConfiguredDumbassProvider(bundle);
  if (!provider) {
    return NextResponse.json({ error: "No LLM API key configured for this account." }, { status: 400 });
  }

  const models = resolveHowToLookLikeADumbassModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const jobId = newJobId();
  const memoTitle = `${project.ticker} — How to Look Like a Dumbass`;
  const targetWords = 12_000;

  const result = await runHowToLookLikeADumbassGeneration({
    userId,
    project,
    companyName: companyName || undefined,
    targetSecurity: targetSecurity || undefined,
    tradingPrice: tradingPrice || undefined,
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

  const done = memoJobFromRun(jobId, project, targetWords, memoTitle, provider, null, result.markdown, result.sourcePack, null);
  await appendJob(userId, done);

  try {
    if (done.markdown) {
      await writeSavedContent(project.ticker, "how-to-look-like-a-dumbass-latest", done.markdown, userId);
      await writeSavedContent(
        project.ticker,
        "how-to-look-like-a-dumbass-latest-source-pack",
        result.sourcePack,
        userId
      );
      await writeSavedContent(
        project.ticker,
        "how-to-look-like-a-dumbass-latest-meta",
        JSON.stringify(
          {
            jobId,
            memoTitle,
            provider,
            llmModel: llmModelUsed,
            createdAt: done.createdAt,
            projectId: project.id,
            companyName: companyName || undefined,
            targetSecurity: targetSecurity || undefined,
            tradingPrice: tradingPrice || undefined,
          },
          null,
          2
        ),
        userId
      );
    }
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
    markdown: result.markdown,
    provider,
    llmModelUsed,
  });
}
