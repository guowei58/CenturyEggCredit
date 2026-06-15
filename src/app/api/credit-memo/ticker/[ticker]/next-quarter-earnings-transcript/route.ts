import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import {
  pickBestConfiguredEarningsTranscriptProvider,
  runNextQuarterEarningsTranscriptGeneration,
} from "@/lib/creditMemo/generateNextQuarterEarningsTranscript";
import { memoOnlyReferenceStubProject } from "@/lib/creditMemo/memoOnlyReferenceProject";
import { appendJob, clearIngestCorpusAfterWorkProduct, getLatestProjectForTicker, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import { creditMemoPrimaryModelId, resolveNextQuarterEarningsTranscriptModels } from "@/lib/ai-model-from-request";
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
    nextQuarter?: string;
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
  const nextQuarter = typeof body.nextQuarter === "string" ? body.nextQuarter.trim() : "";
  const provider = pickBestConfiguredEarningsTranscriptProvider(bundle);
  if (!provider) {
    return NextResponse.json({ error: "No LLM API key configured for this account." }, { status: 400 });
  }

  const models = resolveNextQuarterEarningsTranscriptModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const jobId = newJobId();
  const memoTitle = `${project.ticker} — Next Quarter Earnings Transcript`;
  const targetWords = 12_000;

  const result = await runNextQuarterEarningsTranscriptGeneration({
    userId,
    project,
    companyName: companyName || undefined,
    nextQuarter: nextQuarter || undefined,
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
      await writeSavedContent(project.ticker, "next-quarter-earnings-transcript-latest", done.markdown, userId);
      await writeSavedContent(
        project.ticker,
        "next-quarter-earnings-transcript-latest-source-pack",
        result.sourcePack,
        userId
      );
      await writeSavedContent(
        project.ticker,
        "next-quarter-earnings-transcript-latest-meta",
        JSON.stringify(
          {
            jobId,
            memoTitle,
            provider,
            llmModel: llmModelUsed,
            createdAt: done.createdAt,
            projectId: project.id,
            companyName: companyName || undefined,
            nextQuarter: nextQuarter || undefined,
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
