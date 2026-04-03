import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { memoJobFromRun, runMemoGeneration } from "@/lib/creditMemo/generateMemo";
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

  let body: {
    targetWords?: number;
    targetPages?: number;
    memoTitle?: string;
    provider?: string;
    useTemplate?: boolean;
    voice?: string;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    ollamaModel?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const DEFAULT_TARGET_WORDS = 10_000;
  let targetWords: number;
  if (typeof body.targetWords === "number" && Number.isFinite(body.targetWords)) {
    targetWords = Math.round(body.targetWords);
  } else if (typeof body.targetPages === "number" && Number.isFinite(body.targetPages)) {
    targetWords = Math.round(body.targetPages * 500);
  } else {
    targetWords = DEFAULT_TARGET_WORDS;
  }
  const memoTitle =
    typeof body.memoTitle === "string" && body.memoTitle.trim()
      ? body.memoTitle.trim()
      : `${project.ticker} — Credit Memo`;

  const provider: AiProvider = normalizeAiProvider(body.provider ?? undefined) ?? defaultServerProvider();

  const jobId = newJobId();

  const voice = typeof body.voice === "string" ? body.voice.trim().toLowerCase() : "";
  const voiceId =
    voice === "buffett" ||
    voice === "munger" ||
    voice === "shakespeare" ||
    voice === "lynch" ||
    voice === "soros" ||
    voice === "ackman"
      ? (voice as "buffett" | "munger" | "shakespeare" | "lynch" | "soros" | "ackman")
      : null;

  const voiceSystemPrompt = voiceId
    ? (await import("@/data/credit-memo-voices")).creditMemoVoiceSystemPrompt(voiceId)
    : null;

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

  const result = await runMemoGeneration({
    userId,
    project,
    targetWords,
    memoTitle,
    provider,
    useTemplate: body.useTemplate === true,
    voiceSystemPrompt,
    models: resolveCreditMemoModels(body),
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
    result.outline,
    result.markdown,
    result.sourcePack,
    null
  );
  await appendJob(userId, done);

  // Persist "latest memo" into the per-ticker folder so it survives tab switches/reloads.
  // Best-effort: memo still returns even if this save fails.
  try {
    if (done.markdown) {
      const keyBase =
        voiceId === "buffett"
          ? "ai-credit-memo-buffett"
          : voiceId === "munger"
            ? "ai-credit-memo-munger"
            : voiceId === "shakespeare"
              ? "ai-credit-memo-shakespeare"
              : voiceId === "lynch"
                ? "ai-credit-memo-lynch"
                : voiceId === "soros"
                  ? "ai-credit-memo-soros"
                  : voiceId === "ackman"
                    ? "ai-credit-memo-ackman"
                    : "ai-credit-memo-latest";

      const metaKey = `${keyBase}-meta`;
      const packKey = `${keyBase}-source-pack`;

      await writeSavedContent(project.ticker, keyBase, done.markdown, userId);
      await writeSavedContent(project.ticker, packKey, result.sourcePack, userId);
      await writeSavedContent(
        project.ticker,
        metaKey,
        JSON.stringify(
          {
            jobId,
            memoTitle,
            targetWords,
            provider,
            voice: voiceId,
            createdAt: done.createdAt,
            templateFilename: done.templateFilename ?? null,
            templateId: done.templateId ?? null,
            projectId: project.id,
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
    outline: result.outline,
    markdown: result.markdown,
  });
}
