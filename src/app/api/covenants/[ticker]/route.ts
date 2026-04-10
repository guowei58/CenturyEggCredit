import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readSavedContent, writeSavedContent } from "@/lib/saved-content-hybrid";
import {
  gatherCovenantSources,
  formatSourcesForClaude,
  sourcesFingerprint,
} from "@/lib/covenant-sources";
import { synthesizeCovenantsMarkdown } from "@/lib/covenant-synthesis-claude";
import { resolveProvider } from "@/lib/ai-provider";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { resolveCovenantModels } from "@/lib/ai-model-from-request";
import { getDeepSeekModel } from "@/lib/deepseek";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

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

  const bundled = await gatherCovenantSources(sym, undefined, userId);
  const fp = sourcesFingerprint(bundled.parts);
  const meta = parseMeta(await readSavedContent(sym, "covenants-synthesis-meta", userId));
  const cached = (await readSavedContent(sym, "covenants-synthesis", userId)) ?? "";
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
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const { ticker } = await params;
  const sym = ticker?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!sym || sym.length > 12) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  let requestedProvider: unknown;
  let modelBody: Parameters<typeof resolveCovenantModels>[0] = {};
  try {
    const body = (await request.json()) as {
      provider?: unknown;
      claudeModel?: unknown;
      openaiModel?: unknown;
      geminiModel?: unknown;
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { bundle, userId } = llmAuth.ctx;
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }
  const bundled = await gatherCovenantSources(sym, undefined, userId);
  if (!bundled.hasSubstantiveText) {
    return NextResponse.json(
      {
        error:
          "No substantive text found. Save covenant-related excerpts under Credit Agreements & Indentures (Document list, agreement boxes, etc.) or add .txt/.md uploads, then try again.",
      },
      { status: 400 }
    );
  }

  const userPayload = formatSourcesForClaude(sym, bundled.parts);
  const syn = await synthesizeCovenantsMarkdown(userPayload, provider, resolveCovenantModels(modelBody), bundle);
  if (!syn.ok) {
    return NextResponse.json({ error: syn.error }, { status: 502 });
  }

  const fp = sourcesFingerprint(bundled.parts);
  const now = new Date().toISOString();
  const metaStr = JSON.stringify({ fingerprint: fp, updatedAt: now } satisfies MetaJson, null, 2);

  const w1 = await writeSavedContent(sym, "covenants-synthesis", syn.markdown, userId);
  const w2 = await writeSavedContent(sym, "covenants-synthesis-meta", metaStr, userId);
  if (!w1.ok) return NextResponse.json({ error: w1.error }, { status: 500 });
  if (!w2.ok) return NextResponse.json({ error: w2.error }, { status: 500 });

  return NextResponse.json({
    ok: true,
    markdown: syn.markdown,
    fingerprint: fp,
    updatedAt: now,
  });
}
