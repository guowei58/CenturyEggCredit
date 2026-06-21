import { NextResponse } from "next/server";

import { buildCreditDeckPromptPackage } from "@/lib/creditDeck/runCreditDeckGeneration";
import { getProject } from "@/lib/creditMemo/store";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

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
    deckTitle?: string;
    useTemplate?: boolean;
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
  const deckTitle =
    (typeof body.deckTitle === "string" && body.deckTitle.trim()
      ? body.deckTitle.trim()
      : typeof body.memoTitle === "string" && body.memoTitle.trim()
        ? body.memoTitle.trim()
        : null) ?? `${project.ticker} — Credit Deck`;

  const result = await buildCreditDeckPromptPackage({
    userId,
    project,
    targetWords,
    deckTitle,
    useTemplate: body.useTemplate !== false,
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
    retrievalUsed: result.retrievalUsed,
    userMessageBreakdown: result.userMessageBreakdown,
    evidenceDiagnostics: result.evidenceDiagnostics,
    systemChars: result.systemPrompt.length,
    userChars: result.userPrompt.length,
    copyChars: result.copyPrompt.length,
  });
}
