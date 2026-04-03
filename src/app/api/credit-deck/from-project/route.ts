import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveProvider } from "@/lib/ai-provider";
import { checkOllamaHealth } from "@/lib/ollama";
import { runCreditDeckGeneration } from "@/lib/creditDeck/runCreditDeckGeneration";
import { getProject } from "@/lib/creditMemo/store";
import { clampMemoWordBudget } from "@/lib/creditMemo/memoPlanner";
import { resolveCreditMemoModels } from "@/lib/ai-model-from-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

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

  if (provider === "ollama") {
    const health = await checkOllamaHealth();
    if (health.status === "disconnected") {
      return NextResponse.json({ error: "Ollama not reachable. Run `ollama serve`." }, { status: 503 });
    }
    if (health.status === "model_missing") {
      return NextResponse.json(
        { error: `Ollama model missing. Run: ollama pull ${health.model}` },
        { status: 503 }
      );
    }
    if (health.status === "error") {
      return NextResponse.json({ error: health.detail?.slice(0, 200) ?? "Ollama check failed." }, { status: 503 });
    }
  }

  const result = await runCreditDeckGeneration({
    userId,
    project,
    targetWords,
    deckTitle,
    provider,
    useTemplate: body.useTemplate === true,
    models: resolveCreditMemoModels(body),
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const filename = result.filename.replace(/[^\w.\-]+/g, "_");
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
