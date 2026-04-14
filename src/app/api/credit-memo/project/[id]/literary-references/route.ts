import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import {
  pickBestConfiguredLiteraryProvider,
  runLiteraryReferencesGeneration,
} from "@/lib/creditMemo/generateLiteraryReferences";
import { appendJob, getProject, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import { creditMemoPrimaryModelId, resolveLiteraryReferencesModels } from "@/lib/ai-model-from-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, bundle } = llmAuth.ctx;

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await getProject(userId, id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: {
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
    body = {};
  }

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  const provider = pickBestConfiguredLiteraryProvider(bundle);
  if (!provider) {
    return NextResponse.json({ error: "No LLM API key configured for this account." }, { status: 400 });
  }

  const models = resolveLiteraryReferencesModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const jobId = newJobId();
  const memoTitle = `${project.ticker} — Literary references`;
  const targetWords = 8_000;

  const result = await runLiteraryReferencesGeneration({
    userId,
    project,
    companyName: companyName || undefined,
    provider,
    models,
    apiKeys: bundle,
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
      await writeSavedContent(project.ticker, "literary-references-latest", done.markdown, userId);
      await writeSavedContent(project.ticker, "literary-references-latest-source-pack", result.sourcePack, userId);
      await writeSavedContent(
        project.ticker,
        "literary-references-latest-meta",
        JSON.stringify(
          {
            jobId,
            memoTitle,
            provider,
            llmModel: llmModelUsed,
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
    provider,
    llmModelUsed,
  });
}
