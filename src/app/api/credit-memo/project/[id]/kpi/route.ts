import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import { runKpiGeneration } from "@/lib/creditMemo/generateKpi";
import { appendJob, getProject, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import type { AiProvider } from "@/lib/ai-provider";
import { defaultServerProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { resolveCreditMemoModels } from "@/lib/ai-model-from-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, bundle, responseVerbosity } = llmAuth.ctx;

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await getProject(userId, id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: {
    provider?: string;
    companyName?: string;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider: AiProvider = normalizeAiProvider(body.provider ?? undefined) ?? defaultServerProvider();
  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";

  const jobId = newJobId();
  const memoTitle = `${project.ticker} — KPI`;
  const targetWords = 5_000;

  const result = await runKpiGeneration({
    project,
    provider,
    companyName: companyName || undefined,
    models: resolveCreditMemoModels(body),
    apiKeys: bundle,
    responseVerbosity,
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
      await writeSavedContent(project.ticker, "kpi-latest", done.markdown, userId);
      await writeSavedContent(project.ticker, "kpi-latest-source-pack", result.sourcePack, userId);
      await writeSavedContent(
        project.ticker,
        "kpi-latest-meta",
        JSON.stringify(
          {
            jobId,
            memoTitle,
            provider,
            createdAt: done.createdAt,
            projectId: project.id,
            companyName: companyName || undefined,
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

  return NextResponse.json({
    ok: true,
    jobId,
    markdown: result.markdown,
  });
}

