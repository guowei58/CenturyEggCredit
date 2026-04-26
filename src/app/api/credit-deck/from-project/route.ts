import { NextResponse } from "next/server";

import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { resolveProvider } from "@/lib/ai-provider";
import { runCreditDeckGeneration } from "@/lib/creditDeck/runCreditDeckGeneration";
import { clearIngestCorpusAfterWorkProduct, getProject } from "@/lib/creditMemo/store";
import { clampMemoWordBudget } from "@/lib/creditMemo/memoPlanner";
import { creditMemoPrimaryModelId, resolveCreditMemoModels } from "@/lib/ai-model-from-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(req: Request) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { userId, bundle } = llmAuth.ctx;

  let body: {
    projectId?: string;
    targetWords?: number;
    deckTitle?: string;
    memoTitle?: string;
    useTemplate?: boolean;
    provider?: string;
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

  const projectId = typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  const project = await getProject(userId, projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found — run ingest again." }, { status: 404 });
  }

  const DEFAULT_TARGET_WORDS = 10_000;
  const targetWords =
    typeof body.targetWords === "number" && Number.isFinite(body.targetWords)
      ? clampMemoWordBudget(Math.round(body.targetWords))
      : DEFAULT_TARGET_WORDS;

  const memoTitle =
    typeof body.memoTitle === "string" && body.memoTitle.trim()
      ? body.memoTitle.trim()
      : `${project.ticker} — Credit Memo`;

  const deckTitle =
    typeof body.deckTitle === "string" && body.deckTitle.trim()
      ? body.deckTitle.trim()
      : memoTitle.replace(/\bcredit\s+memo\b/gi, "Credit Deck").replace(/\bMemo\b/, "Deck");

  const provider = resolveProvider(body.provider);
  const models = resolveCreditMemoModels(body);
  const llmModelUsed = creditMemoPrimaryModelId(provider, models);

  const result = await runCreditDeckGeneration({
    userId,
    project,
    targetWords,
    deckTitle,
    provider,
    useTemplate: body.useTemplate !== false,
    models,
    apiKeys: bundle,
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  try {
    await clearIngestCorpusAfterWorkProduct(userId, projectId);
  } catch {
    /* best-effort */
  }

  const filename = result.filename.replace(/[^\w.\-]+/g, "_");
  const deckTelemetry = JSON.stringify({
    evidenceDiagnostics: result.evidenceDiagnostics,
    userMessageBreakdown: result.userMessageBreakdown,
    retrievalUsed: result.retrievalUsed,
    systemMessageChars: result.sentSystemMessage.length,
    userMessageChars: result.sentUserMessage.length,
  });
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Ceg-Llm-Provider": provider,
      "X-Ceg-Llm-Model-Id": llmModelUsed,
      "X-Ceg-Deck-Run-Telemetry": Buffer.from(deckTelemetry, "utf8").toString("base64"),
    },
  });
}
