import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { resolveProvider } from "@/lib/ai-provider";
import type { ModelOverrideBody } from "@/lib/ai-model-from-request";
import { loadExhibit21UniverseForTicker } from "@/lib/entity-mapper-v2/exhibit21Universe";
import { modelsFromBody, runEntityMapperV2Pipeline } from "@/lib/entity-mapper-v2/pipeline";
import type { EntityMapperV2Snapshot } from "@/lib/entity-mapper-v2/types";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured } from "@/lib/llm-router";
import { readSavedContent } from "@/lib/saved-content-hybrid";
import { getDeepSeekModel } from "@/lib/deepseek";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function parseSnapshot(raw: string | null): EntityMapperV2Snapshot | null {
  if (!raw?.trim()) return null;
  try {
    const o = JSON.parse(raw) as EntityMapperV2Snapshot;
    if (o && o.version === 2 && typeof o.ticker === "string") {
      if (!Array.isArray(o.subsidiariesNotInExhibit21)) {
        return { ...o, subsidiariesNotInExhibit21: [] };
      }
      return o;
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
    return NextResponse.json({
      ticker: sym,
      needsSignIn: true,
      exhibit21Universe: [],
      profileUpdatedAtIso: null,
      snapshot: null,
      anthropicConfigured: false,
      openaiConfigured: false,
      geminiConfigured: false,
      deepseekConfigured: false,
      deepseekDefaultModel: "",
    });
  }

  const llmAuth = await getAuthenticatedLlmContext();
  const kb = llmAuth.ok ? llmAuth.ctx.bundle : {};

  const [{ rows: exhibit21Universe, profileUpdatedAtIso }, snapRaw] = await Promise.all([
    loadExhibit21UniverseForTicker(userId, sym),
    readSavedContent(sym, "entity-mapper-v2-snapshot", userId),
  ]);

  return NextResponse.json({
    ticker: sym,
    needsSignIn: false,
    exhibit21Universe,
    profileUpdatedAtIso,
    snapshot: parseSnapshot(snapRaw),
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
  let companyNameFromClient: string | undefined;
  let discoverSecDocuments = true;
  let downloadExhibitsToSavedDocs = true;
  let maxSavedDocumentDownloads = 80;
  let modelBody: ModelOverrideBody = {};

  try {
    const body = (await request.json()) as {
      provider?: unknown;
      companyName?: unknown;
      discoverSecDocuments?: unknown;
      downloadExhibitsToSavedDocs?: unknown;
      maxSavedDocumentDownloads?: unknown;
      claudeModel?: unknown;
      openaiModel?: unknown;
      geminiModel?: unknown;
      deepseekModel?: unknown;
      ollamaModel?: unknown;
    };
    requestedProvider = body?.provider;
    if (typeof body?.companyName === "string" && body.companyName.trim()) {
      companyNameFromClient = body.companyName.trim();
    }
    if (body?.discoverSecDocuments === false) discoverSecDocuments = false;
    if (body?.downloadExhibitsToSavedDocs === false) downloadExhibitsToSavedDocs = false;
    if (typeof body?.maxSavedDocumentDownloads === "number" && Number.isFinite(body.maxSavedDocumentDownloads)) {
      maxSavedDocumentDownloads = Math.min(150, Math.max(1, Math.floor(body.maxSavedDocumentDownloads)));
    }
    modelBody = {
      claudeModel: body.claudeModel,
      openaiModel: body.openaiModel,
      geminiModel: body.geminiModel,
      deepseekModel: body.deepseekModel,
      ollamaModel: body.ollamaModel,
    };
  } catch {
    requestedProvider = undefined;
  }

  const provider = resolveProvider(requestedProvider);
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in to run Entity Mapper." }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const result = await runEntityMapperV2Pipeline({
    userId,
    ticker: sym,
    provider,
    bundle,
    models: modelsFromBody(modelBody),
    companyNameHint: companyNameFromClient,
    discoverSecDocuments,
    downloadExhibitsToSavedDocs,
    maxSavedDocumentDownloads,
  });

  if (!result.ok) {
    const status =
      result.code === "no_subsidiaries" || result.code === "no_sources"
        ? 400
        : result.code === "edgar"
          ? 422
          : result.code === "llm" || result.code === "parse"
            ? 502
            : 500;
    return NextResponse.json({ error: result.error, code: result.code }, { status });
  }

  return NextResponse.json({
    ok: true,
    snapshot: result.snapshot,
    savedDocumentsSummary: result.savedDocumentsSummary
      ? {
          attempted: result.savedDocumentsSummary.attempted,
          savedCount: result.savedDocumentsSummary.saved.length,
          failedCount: result.savedDocumentsSummary.failed.length,
        }
      : null,
  });
}
