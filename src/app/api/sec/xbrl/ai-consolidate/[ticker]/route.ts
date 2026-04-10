import { NextResponse } from "next/server";
import { normalizeAiProvider, type AiProvider } from "@/lib/ai-provider";
import { resolveCommitteeChatModels } from "@/lib/ai-model-from-request";
import { getAuthenticatedLlmContext } from "@/lib/llm-session-keys";
import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import { openAiXbrlConsolidateFetchTimeoutMs } from "@/lib/openai";
import { buildSavedXbrlTextPack } from "@/lib/xbrl-ai-consolidation/ingestSavedXbrlPack";
import { getXbrlAiConsolidationInstructions } from "@/lib/xbrl-ai-consolidation/loadInstructions";
import {
  buildMergedFactsAndLineIndex,
  validateConsolidatedMarkdownAgainstXbrl,
} from "@/lib/xbrl-ai-consolidation/sourceFacts";
import { repairConsolidatedMarkdownFromSourceFacts } from "@/lib/xbrl-ai-consolidation/repairMarkdownFromSourceFacts";
import { formatReconciliationAppendix, reconcileConsolidatedMarkdown } from "@/lib/xbrl-ai-consolidation/statementReconciliation";
import { writeUserTickerDocument } from "@/lib/user-workspace-store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
/**
 * Vercel caps this at 300s on Hobby (and many hosts). Keep OpenAI wait ≤ this via
 * OPENAI_XBRL_CONSOLIDATE_FETCH_TIMEOUT_MS; Pro plans allow higher `maxDuration` if you raise both.
 */
export const maxDuration = 300;

const SAVE_KEY = "xbrl-consolidated-financials-ai" as const;

/**
 * POST { provider?, maxTokens?, claudeModel?, openaiModel?, geminiModel?, deepseekModel? }
 * — Ingest all saved SEC-XBRL xlsx for the ticker, run one-shot LLM consolidation per consolidation-instructions.txt,
 * save Markdown to `xbrl-consolidated-financials-ai`.
 */
export async function POST(request: Request, { params }: { params: Promise<{ ticker: string }> }) {
  const llmAuth = await getAuthenticatedLlmContext();
  if (!llmAuth.ok) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { userId, bundle } = llmAuth.ctx;

  const { ticker } = await params;
  const sym = sanitizeTicker(ticker ?? "");
  if (!sym) {
    return NextResponse.json({ error: "Ticker required" }, { status: 400 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  const b = body as {
    provider?: unknown;
    maxTokens?: unknown;
    claudeModel?: unknown;
    openaiModel?: unknown;
    geminiModel?: unknown;
    deepseekModel?: unknown;
    ollamaModel?: unknown;
  };

  const provider = normalizeAiProvider(b.provider) as AiProvider | null;
  if (!provider) {
    return NextResponse.json({ error: "provider must be claude, openai, gemini, or deepseek" }, { status: 400 });
  }

  if (!isProviderConfigured(provider, bundle)) {
    return NextResponse.json({ error: USER_LLM_KEY_SETTINGS_HINT }, { status: 503 });
  }

  const pack = await buildSavedXbrlTextPack(userId, sym);
  if (!pack.ok) {
    return NextResponse.json({ error: pack.error }, { status: 400 });
  }

  let maxTokens = 32_768;
  if (typeof b.maxTokens === "number" && Number.isFinite(b.maxTokens)) {
    maxTokens = Math.min(32_768, Math.max(256, Math.round(b.maxTokens)));
  }

  const system = getXbrlAiConsolidationInstructions();
  const user = `You will receive CSV text extracted from in-app saved Excel workbooks (SEC-XBRL-financials exports). Apply the instructions in your system message to this data.

Hard rule: do not calculate or re-sum amounts except where the system message explicitly allows standalone quarters from YTD (including 4Q = FY − 9M when needed) and standalone quarterly cash flow from YTD when needed. Otherwise transcribe numbers from the files (after Latest Filing Wins). Include every Income Statement line from the CSVs (every Concept), including equity-method / affiliate and other non-operating lines — do not drop rows.

Hard rule — period columns (Income Statement, Balance Sheet, Cash Flow): For **every** fiscal year from the earliest through the latest year present in the data, output **exactly five** period columns in this order: **1Q, 2Q, 3Q, 4Q, FY** (consistent labels, e.g. 1Q19…FY19). **Never** skip a quarter or FY to save space. If the source has no figure, use **—** but **keep the column**.

--- BEGIN DATA (${pack.fileCount} workbook(s), ${pack.sheetCount} sheet(s) total; truncated=${pack.truncated}) ---

${pack.text}

--- END DATA ---`;

  const models = resolveCommitteeChatModels(b);
  const result = await llmCompleteSingle(provider, system, user, {
    maxTokens,
    claudeModel: models.claudeModel,
    openaiModel: models.openaiModel,
    geminiModel: models.geminiModel,
    deepseekModel: models.deepseekModel,
    openaiFetchTimeoutMs: provider === "openai" ? openAiXbrlConsolidateFetchTimeoutMs() : undefined,
    apiKeys: bundle,
  });

  if (!result.ok) {
    const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502;
    const msg = result.error.length > 600 ? "Model request failed" : result.error;
    return NextResponse.json({ error: msg }, { status });
  }

  const outputTruncated = Boolean(result.ok && result.outputTruncated);

  let bodyText = result.text.trim();
  const built = await buildMergedFactsAndLineIndex(userId, sym);
  if (built && built.merged.length > 0) {
    bodyText = repairConsolidatedMarkdownFromSourceFacts(bodyText, built.merged);
  }

  const reconLines = reconcileConsolidatedMarkdown(bodyText);
  const text = `${bodyText.trimEnd()}${formatReconciliationAppendix(reconLines)}`;

  const saved = await writeUserTickerDocument(userId, sym, SAVE_KEY, text);
  if (!saved.ok) {
    return NextResponse.json({ error: saved.error }, { status: 500 });
  }

  const validation =
    built && built.merged.length > 0
      ? validateConsolidatedMarkdownAgainstXbrl(text, built.merged, built.conceptToLines)
      : null;

  return NextResponse.json({
    ok: true,
    text,
    saveKey: SAVE_KEY,
    fileCount: pack.fileCount,
    filenames: pack.filenames,
    truncated: pack.truncated,
    /** Model hit max output tokens (e.g. ChatGPT ~16k); consolidated markdown is incomplete. */
    outputTruncated,
    sheetCount: pack.sheetCount,
    validation,
    reconciliationMismatchCount: reconLines.filter((l) => !l.ok).length,
  });
}
