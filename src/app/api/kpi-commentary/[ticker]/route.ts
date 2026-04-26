import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import { gatherKpiCommentarySources } from "@/lib/kpi-workspace-sources";
import { runKpiCommentaryFromTicker } from "@/lib/kpi-commentary-run";
import { resolveProvider } from "@/lib/ai-provider";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { resolveLmeAnalysisModels } from "@/lib/ai-model-from-request";
import { getDeepSeekModel } from "@/lib/deepseek";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

type MetaJson = { fingerprint: string; updatedAt: string };

function parseMeta(raw: string | null): MetaJson | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as Partial<MetaJson> & Record<string, unknown>;
    if (typeof o.fingerprint === "string" && typeof o.updatedAt === "string") {
      return { fingerprint: o.fingerprint, updatedAt: o.updatedAt };
    }
    return null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id ?? null;

  if (!userId) {
    return NextResponse.json(
      {
        ticker: sym,
        sourceInventory: [],
        totalChars: 0,
        hasSubstantiveText: false,
        currentFingerprint: "",
        cacheFingerprint: null,
        cacheStale: true,
        cacheUpdatedAt: null,
        cachedMarkdown: null,
        anthropicConfigured: false,
        openaiConfigured: false,
        geminiConfigured: false,
        deepseekConfigured: false,
        deepseekDefaultModel: "",
        needsSignIn: true,
      },
      { status: 200 }
    );
  }

  const bundled = await gatherKpiCommentarySources(sym, undefined, userId, { useRetrieval: false, inventoryOnly: true });
  const fp = bundled.sourceFingerprint;
  const meta = parseMeta(await readSavedContent(sym, "kpi-latest-meta", userId));
  const cached = (await readSavedContent(sym, "kpi-latest", userId)) ?? "";
  const llmAuth = await getAuthenticatedLlmContext();
  const kb = llmAuth.ok ? llmAuth.ctx.bundle : {};

  const sourceInventory = bundled.parts.map((p) => ({
    label: p.label,
    key: p.key,
    charsInitial: p.charsInitial,
    truncated: p.truncated,
    isBinaryPlaceholder: p.content.startsWith("[Binary"),
  }));
  const totalChars = bundled.parts.reduce((s, p) => s + p.charsInitial, 0);

  return NextResponse.json({
    ticker: sym,
    sourceInventory,
    totalChars,
    hasSubstantiveText: bundled.hasSubstantiveText,
    currentFingerprint: fp,
    cacheFingerprint: meta?.fingerprint ?? null,
    cacheStale: meta ? meta.fingerprint !== fp : true,
    cacheUpdatedAt: meta?.updatedAt ?? null,
    cachedMarkdown: cached.trim().length > 0 ? cached : null,
    anthropicConfigured: isProviderConfigured("claude", kb),
    openaiConfigured: isProviderConfigured("openai", kb),
    geminiConfigured: isProviderConfigured("gemini", kb),
    deepseekConfigured: isProviderConfigured("deepseek", kb),
    deepseekDefaultModel: getDeepSeekModel(),
    needsSignIn: false,
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  let requestedProvider: unknown;
  let modelBody: Parameters<typeof resolveLmeAnalysisModels>[0] = {};
  let companyName = "";
  try {
    const body = (await request.json()) as {
      provider?: unknown;
      companyName?: unknown;
      claudeModel?: unknown;
      openaiModel?: unknown;
      geminiModel?: unknown;
      deepseekModel?: unknown;
      ollamaModel?: unknown;
    };
    requestedProvider = body?.provider;
    modelBody = body;
    companyName = typeof body.companyName === "string" ? body.companyName.trim() : "";
  } catch {
    requestedProvider = undefined;
  }
  const provider = resolveProvider(requestedProvider);
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to run KPI commentary." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const result = await runKpiCommentaryFromTicker({
    ticker: sym,
    userId,
    provider,
    companyName: companyName || undefined,
    models: resolveLmeAnalysisModels(modelBody),
    apiKeys: bundle,
  });

  if (!result.ok) {
    const noSources = result.error.toLowerCase().includes("no substantive");
    const keyHint = result.error === USER_LLM_KEY_SETTINGS_HINT;
    if (result.error === "Invalid ticker" || noSources) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (keyHint) {
      return NextResponse.json({ error: result.error }, { status: 503 });
    }
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const fp = result.sourceFingerprint;
  const now = new Date().toISOString();
  const metaStr = JSON.stringify({ fingerprint: fp, updatedAt: now } satisfies MetaJson, null, 2);

  const w1 = await writeSavedContent(sym, "kpi-latest", result.markdown, userId);
  const w2 = await writeSavedContent(sym, "kpi-latest-meta", metaStr, userId);
  const w3 = await writeSavedContent(sym, "kpi-latest-source-pack", result.sourcePack, userId);
  if (!w1.ok) return NextResponse.json({ error: w1.error }, { status: 500 });
  if (!w2.ok) return NextResponse.json({ error: w2.error }, { status: 500 });
  if (!w3.ok) return NextResponse.json({ error: w3.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    markdown: result.markdown,
    fingerprint: fp,
    updatedAt: now,
    retrievalUsed: result.retrievalUsed,
    sentSystemMessage: result.sentSystemMessage,
    sentUserMessage: result.sentUserMessage,
    packingStats: result.packingStats,
    userMessageBreakdown: result.userMessageBreakdown,
  });
}
