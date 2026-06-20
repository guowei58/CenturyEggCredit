import { NextResponse } from "next/server";

import { auth } from "@/auth";
import {
  DOC_REVIEW_PROMPT,
  getCreditAgreementsDocReviewAiPrompt,
} from "@/lib/credit-agreements-prompts";
import { resolveProvider } from "@/lib/ai-provider";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import { WEB_SEARCH_TOOL, isClaudeWebSearchToolEnabled } from "@/lib/anthropic";
import type { CreditDocSavedBoxKey } from "@/lib/credit-doc-save-targets";
import { appendRelevantBackgroundToDocReviewPrompt } from "@/lib/credit-doc-review-background-client";
import { collectCreditDocReviewBackground } from "@/lib/credit-doc-review-background";
import { buildCreditDocReviewUserPrompt } from "@/lib/credit-doc-review-prompt-build";
import { isGeminiGoogleSearchEnabled } from "@/lib/gemini";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { isOpenAiWebSearchEnabled } from "@/lib/openai";
import { readPromptTemplateOverride } from "@/lib/prompt-template-storage";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { writeSavedContent } from "@/lib/saved-content-hybrid";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { withPromptBenchmarkNotice } from "@/lib/prompt-benchmark-notice";
import { applyResearchTabPromptStyle } from "@/lib/research-tab-output-style";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

const VALID_SAVE_KEYS = new Set<CreditDocSavedBoxKey>([
  "credit-agreements-indentures-credit-agreement",
  "credit-agreements-indentures-first-lien-indenture",
  "credit-agreements-indentures-second-lien-indenture",
  "credit-agreements-indentures-unsecured",
  "credit-agreements-indentures-other-credit-documents",
]);

export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  try {
    return await handleBulkCreditDocAnalyzePost(request, params);
  } catch (e) {
    console.error("[bulk-credit-doc-analyze]", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Credit doc analysis failed unexpectedly." },
      { status: 500 }
    );
  }
}

async function handleBulkCreditDocAnalyzePost(
  request: Request,
  params: Promise<{ ticker: string }>
) {
  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) {
    return NextResponse.json({ error: "Invalid ticker" }, { status: 400 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }
  const { bundle, llmTemperature } = llmAuth.ctx;

  let body: {
    provider?: unknown;
    url?: unknown;
    saveKey?: unknown;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const provider = resolveProvider(body.provider);
  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!url.startsWith("http")) {
    return NextResponse.json({ error: "A valid document URL is required." }, { status: 400 });
  }

  const saveKey = typeof body.saveKey === "string" ? (body.saveKey.trim() as CreditDocSavedBoxKey) : null;
  if (!saveKey || !VALID_SAVE_KEYS.has(saveKey)) {
    return NextResponse.json({ error: "Invalid saveKey for credit doc analysis." }, { status: 400 });
  }

  const template = readPromptTemplateOverride("credit-agreements-doc-review", DOC_REVIEW_PROMPT);
  const basePrompt = getCreditAgreementsDocReviewAiPrompt(template);
  const background = (await collectCreditDocReviewBackground(userId, sym)) ?? {
    capitalStructureNotes: null,
    orgChartNotes: null,
  };
  const withBackground = appendRelevantBackgroundToDocReviewPrompt(basePrompt, background);
  const built = await buildCreditDocReviewUserPrompt(withBackground, url);
  const styled = applyResearchTabPromptStyle({
    userPrompt: built.prompt,
    researchSaveKey: saveKey,
  });
  const userPrompt = withPromptBenchmarkNotice(styled.userPrompt);

  const models = resolveCommitteeChatModels(body);
  const result = await llmCompleteSingle(
    provider,
    "You are a senior distressed debt and covenant analyst. Follow the user prompt exactly.",
    userPrompt,
    {
      apiKeys: bundle,
      temperature: llmTemperature,
      maxTokens: LLM_MAX_OUTPUT_TOKENS,
      claudeModel: models.claudeModel,
      openaiModel: models.openaiModel,
      geminiModel: models.geminiModel,
      deepseekModel: models.deepseekModel,
      claudeTools:
        provider === "claude" && isClaudeWebSearchToolEnabled() ? [WEB_SEARCH_TOOL] : undefined,
      openaiWebSearch: provider === "openai" && isOpenAiWebSearchEnabled(),
      geminiGoogleSearch: provider === "gemini" && isGeminiGoogleSearchEnabled(),
    }
  );

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const text = result.text.trim();
  if (!text) {
    return NextResponse.json({ error: "Model returned empty text." }, { status: 502 });
  }

  await writeSavedContent(sym, saveKey, text, userId);

  return NextResponse.json({
    ok: true,
    saveKey,
    chars: text.length,
    url,
    documentInlined: built.documentInlined,
    ...(built.fetchError && !built.documentInlined ? { fetchWarning: built.fetchError } : {}),
  });
}
