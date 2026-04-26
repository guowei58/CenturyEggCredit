import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import { resolveProvider } from "@/lib/ai-provider";
import { resolveLmeAnalysisModels } from "@/lib/ai-model-from-request";
import { runForensicAccountingAnalysisGeneration } from "@/lib/creditMemo/generateForensicAccountingAnalysis";
import { gatherForensicWorkspaceSources } from "@/lib/forensic-workspace-sources";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { getDeepSeekModel } from "@/lib/deepseek";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 600;
export const runtime = "nodejs";

type MetaJson = { fingerprint: string; updatedAt: string };

function parseMeta(raw: string | null): MetaJson | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as { fingerprint?: string; sourceFingerprint?: string; updatedAt?: string };
    const fp = (
      typeof o.fingerprint === "string" ? o.fingerprint : typeof o.sourceFingerprint === "string" ? o.sourceFingerprint : ""
    ).trim();
    const updatedAt = typeof o.updatedAt === "string" ? o.updatedAt.trim() : "";
    if (fp && updatedAt) return { fingerprint: fp, updatedAt };
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
        retrievalUsed: false,
      },
      { status: 200 }
    );
  }

  const bundled = await gatherForensicWorkspaceSources(sym, undefined, userId, { useRetrieval: false, inventoryOnly: true });
  const fp = bundled.sourceFingerprint;
  const meta = parseMeta(await readSavedContent(sym, "forensic-accounting-latest-meta", userId));
  const cached = (await readSavedContent(sym, "forensic-accounting-latest", userId)) ?? "";
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
    retrievalUsed: bundled.retrievalUsed,
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
      companyName?: string;
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
    return NextResponse.json({ error: "Sign in to run forensic analysis." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const result = await runForensicAccountingAnalysisGeneration({
    ticker: sym,
    provider,
    companyName: companyName || undefined,
    models: resolveLmeAnalysisModels(modelBody),
    apiKeys: bundle,
    userId,
  });

  if (!result.ok) {
    const msg = result.error;
    const lower = msg.toLowerCase();
    const noSources =
      lower.includes("no substantive") ||
      lower.includes("no ingestible workspace") ||
      lower.includes("no sources found");
    const keyHint = msg === USER_LLM_KEY_SETTINGS_HINT;
    if (noSources) {
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    if (keyHint) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 502 });
  }

  const sourceFp = result.sourceFingerprint;
  const now = new Date().toISOString();
  const metaStr = JSON.stringify({ fingerprint: sourceFp, updatedAt: now } satisfies MetaJson, null, 2);

  const w1 = await writeSavedContent(sym, "forensic-accounting-latest", result.markdown, userId);
  const w2 = await writeSavedContent(sym, "forensic-accounting-latest-source-pack", result.sourcePack, userId);
  const w3 = await writeSavedContent(sym, "forensic-accounting-latest-meta", metaStr, userId);
  if (!w1.ok) return NextResponse.json({ error: w1.error }, { status: 500 });
  if (!w2.ok) return NextResponse.json({ error: w2.error }, { status: 500 });
  if (!w3.ok) return NextResponse.json({ error: w3.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    markdown: result.markdown,
    fingerprint: sourceFp,
    updatedAt: now,
    retrievalUsed: result.diagnostics.retrievalUsed,
    sentSystemMessage: result.sentSystemMessage,
    sentUserMessage: result.sentUserMessage,
    packingStats: result.diagnostics.packingStats ?? null,
    userMessageBreakdown: result.diagnostics.userMessageBreakdown,
  });
}
