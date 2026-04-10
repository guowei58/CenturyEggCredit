import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import { gatherLmeSources, formatSourcesForLme, lmeSourcesFingerprint } from "@/lib/lme-sources";
import { synthesizeLmeAnalysisMarkdown } from "@/lib/lme-analysis-synthesis";
import { resolveProvider } from "@/lib/ai-provider";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { resolveLmeAnalysisModels } from "@/lib/ai-model-from-request";
import { getDeepSeekModel } from "@/lib/deepseek";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MetaJson = { fingerprint: string; updatedAt: string };

function parseMeta(raw: string | null): MetaJson | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as MetaJson;
    if (typeof o.fingerprint === "string" && typeof o.updatedAt === "string") return o;
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

  const bundled = await gatherLmeSources(sym, undefined, userId);
  const fp = lmeSourcesFingerprint(bundled.parts);
  const meta = parseMeta(await readSavedContent(sym, "lme-analysis-meta", userId));
  const cached = (await readSavedContent(sym, "lme-analysis", userId)) ?? "";
  const llmAuth = await getAuthenticatedLlmContext();
  const kb = llmAuth.ok ? llmAuth.ctx.bundle : {};

  const sourceInventory = bundled.parts.map((p) => ({
    label: p.label,
    key: p.key,
    chars: p.content.length,
    truncated: p.truncated,
    isBinaryPlaceholder: p.content.startsWith("[Binary"),
  }));

  return NextResponse.json({
    ticker: sym,
    sourceInventory,
    totalChars: bundled.totalChars,
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
  try {
    const body = (await request.json()) as {
      provider?: unknown;
      claudeModel?: unknown;
      openaiModel?: unknown;
      geminiModel?: unknown;
      deepseekModel?: unknown;
      ollamaModel?: unknown;
    };
    requestedProvider = body?.provider;
    modelBody = body;
  } catch {
    requestedProvider = undefined;
  }
  const provider = resolveProvider(requestedProvider);
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to run LME analysis." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }
  const bundled = await gatherLmeSources(sym, undefined, userId);
  if (!bundled.hasSubstantiveText) {
    return NextResponse.json(
      {
        error:
          "No substantive sources found. Save responses under Capital Structure, Org Chart, Subsidiary List, and Credit Agreements & Indentures (or upload .txt/.md covenant excerpts and Capital Structure / Org Chart / Subsidiary List Excel files), then try again.",
      },
      { status: 400 }
    );
  }

  const userPayload = formatSourcesForLme(sym, bundled.parts);
  const syn = await synthesizeLmeAnalysisMarkdown(
    userPayload,
    provider,
    resolveLmeAnalysisModels(modelBody),
    bundle
  );
  if (!syn.ok) {
    return NextResponse.json({ error: syn.error }, { status: 502 });
  }

  const fp = lmeSourcesFingerprint(bundled.parts);
  const now = new Date().toISOString();
  const metaStr = JSON.stringify({ fingerprint: fp, updatedAt: now } satisfies MetaJson, null, 2);

  const w1 = await writeSavedContent(sym, "lme-analysis", syn.markdown, userId);
  const w2 = await writeSavedContent(sym, "lme-analysis-meta", metaStr, userId);
  if (!w1.ok) return NextResponse.json({ error: w1.error }, { status: 500 });
  if (!w2.ok) return NextResponse.json({ error: w2.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    markdown: syn.markdown,
    fingerprint: fp,
    updatedAt: now,
  });
}
