import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { memoJobFromRun, runMemoGeneration } from "@/lib/creditMemo/generateMemo";
import { appendJob, getProject, newJobId } from "@/lib/creditMemo/store";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import type { AiProvider } from "@/lib/ai-provider";
import { defaultServerProvider, normalizeAiProvider } from "@/lib/ai-provider";
import { creditMemoPrimaryModelId, resolveCreditMemoModels } from "@/lib/ai-model-from-request";

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
    targetWords?: number;
    targetPages?: number;
    memoTitle?: string;
    provider?: string;
    useTemplate?: boolean;
    voice?: string;
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

  const models = resolveCreditMemoModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const result = await runMemoGeneration({
    userId,
    project,
    targetWords,
    memoTitle,
    provider,
    /** Default on: follow uploaded DOCX outline when present (client may send false to use generic sections). */
    useTemplate: body.useTemplate !== false,
    voiceSystemPrompt,
    models,
    apiKeys: bundle,
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
            llmModel: llmModelUsed,
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
    llmModelUsed,
  });
}
