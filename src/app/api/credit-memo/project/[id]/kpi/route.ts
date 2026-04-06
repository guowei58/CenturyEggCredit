import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { memoJobFromRun } from "@/lib/creditMemo/generateMemo";
import { runKpiGeneration } from "@/lib/creditMemo/generateKpi";
import { appendJob, getProject, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import type { AiProvider } from "@/lib/ai-provider";
import { defaultServerProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { checkOllamaHealth } from "@/lib/ollama";
import { resolveCreditMemoModels } from "@/lib/ai-model-from-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await getProject(userId, id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: { provider?: string; companyName?: string; claudeModel?: unknown; openaiModel?: unknown; geminiModel?: unknown; ollamaModel?: unknown };
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

  if (provider === "ollama") {
    const health = await checkOllamaHealth();
    if (health.status === "disconnected") {
      return NextResponse.json({ ok: false, error: "Ollama not reachable. Run `ollama serve`." }, { status: 503 });
    }
    if (health.status === "model_missing") {
      return NextResponse.json(
        { ok: false, error: `Ollama model missing. Run: ollama pull ${health.model}` },
        { status: 503 }
      );
    }
    if (health.status === "error") {
      return NextResponse.json(
        { ok: false, error: health.detail?.slice(0, 200) ?? "Ollama check failed." },
        { status: 503 }
      );
    }
  }

  const result = await runKpiGeneration({
    project,
    provider,
    companyName: companyName || undefined,
    models: resolveCreditMemoModels(body),
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

