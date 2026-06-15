import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { buildCreditMemoPromptPackage } from "@/lib/creditMemo/generateMemo";
import { getProject } from "@/lib/creditMemo/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to build the context window." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;

  const id = params.id?.trim();
  if (!id) return NextResponse.json({ error: "Missing project id" }, { status: 400 });

  const project = await getProject(userId, id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let body: {
    targetWords?: number;
    targetPages?: number;
    memoTitle?: string;
    useTemplate?: boolean;
    voice?: string;
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

  const voice = typeof body.voice === "string" ? body.voice.trim().toLowerCase() : "";
  const voiceId =
    voice === "buffett" ||
    voice === "munger" ||
    voice === "shakespeare" ||
    voice === "lynch" ||
    voice === "soros" ||
    voice === "ackman" ||
    voice === "kafka" ||
    voice === "nietzsche"
      ? (voice as
          | "buffett"
          | "munger"
          | "shakespeare"
          | "lynch"
          | "soros"
          | "ackman"
          | "kafka"
          | "nietzsche")
      : null;

  const voiceSystemPrompt = voiceId
    ? (await import("@/data/credit-memo-voices")).creditMemoVoiceSystemPrompt(voiceId)
    : null;

  const result = await buildCreditMemoPromptPackage({
    userId,
    project,
    targetWords,
    memoTitle,
    useTemplate: body.useTemplate !== false,
    voiceSystemPrompt,
    apiKeys: bundle,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({
    ok: true,
    outline: result.outline,
    systemPrompt: result.systemPrompt,
    userPrompt: result.userPrompt,
    copyPrompt: result.copyPrompt,
    sharedContext: result.sharedContext,
    retrievalUsed: result.retrievalUsed,
    userMessageBreakdown: result.userMessageBreakdown,
    evidenceDiagnostics: result.evidenceDiagnostics,
    systemChars: result.systemPrompt.length,
    userChars: result.userPrompt.length,
    copyChars: result.copyPrompt.length,
  });
}
