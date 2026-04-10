import { isProviderConfigured, llmCompleteSingle } from "@/lib/llm-router";
import type { AiProvider } from "@/lib/ai-provider";
import type { ResponseVerbosity } from "@/lib/llm-response-verbosity";
import type { LlmCallApiKeys } from "@/lib/user-llm-keys";
import { USER_LLM_KEY_SETTINGS_HINT } from "@/lib/user-llm-keys";
import { buildEvidencePackSync, formatSourceInventoryList } from "@/lib/creditMemo/evidencePack";
import { loadCreditMemoConfig } from "@/lib/creditMemo/config";
import { planMemoOutline, planMemoOutlineFromTemplate } from "@/lib/creditMemo/memoPlanner";
import type { CreditMemoProject, MemoOutline } from "@/lib/creditMemo/types";
import { getActiveCreditMemoTemplate } from "@/lib/creditMemo/templateStore";
import type { CreditMemoResolvedModels } from "@/lib/creditMemo/generateMemo";
import { buildCreditDeckPptxBuffer, type DeckSlideSpec } from "./pptxBuilder";

const DECK_SYSTEM = `You are a senior credit and equity research analyst building a first-draft PowerPoint credit deck.

Rules:
- Use ONLY facts supported by the EVIDENCE and FILE INVENTORY. If something is not in the evidence, do not invent it — use an empty bullet list or a single bullet "[need additional information]".
- Output MUST be a single JSON object, no markdown fences, no commentary.
- Slides must match the credit memo outline: same count, same "title" strings (exact match), same order as listed.
- Each slide: 3–7 concise bullets suitable for a presentation (not long paragraphs). Prefer numbers and concrete facts when present in evidence.
- JSON shape:
{
  "slides": [
    { "title": "<exact section title from outline>", "bullets": ["...", "..."] }
  ]
}`.trim();

function estimateTokensFromChars(chars: number): number {
  return Math.ceil(chars / 4);
}

function normTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseDeckJson(raw: string): Array<{ title: string; bullets: string[] }> {
  let t = raw.trim();
  const fence = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/im.exec(t);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("Model did not return JSON with slides.");
  t = t.slice(start, end + 1);
  const parsed = JSON.parse(t) as { slides?: unknown };
  if (!Array.isArray(parsed.slides)) throw new Error("Invalid deck JSON: missing slides array.");

  return parsed.slides.map((row, i) => {
    if (!row || typeof row !== "object") throw new Error(`Invalid slide at index ${i}`);
    const r = row as { title?: unknown; bullets?: unknown };
    const title = typeof r.title === "string" ? r.title.trim() : "";
    const bullets = Array.isArray(r.bullets)
      ? r.bullets.map((b) => (typeof b === "string" ? b.trim() : "")).filter(Boolean)
      : [];
    if (!title) throw new Error(`Slide ${i} missing title`);
    return { title, bullets };
  });
}

function alignSlidesToOutline(outline: MemoOutline, parsed: Array<{ title: string; bullets: string[] }>): DeckSlideSpec[] {
  const byNorm = new Map<string, { title: string; bullets: string[] }>();
  for (const s of parsed) {
    byNorm.set(normTitle(s.title), { title: s.title, bullets: s.bullets });
  }

  return outline.sections.map((sec) => {
    const hit = byNorm.get(normTitle(sec.title));
    const bullets = hit?.bullets?.filter((b) => b.length > 0).slice(0, 8) ?? [];
    return {
      title: sec.title,
      bullets: bullets.length > 0 ? bullets : ["[need additional information]"],
    };
  });
}

function buildDeckUserPrompt(params: {
  deckTitle: string;
  ticker: string;
  outline: MemoOutline;
  templateMetaLine: string;
  inventory: string;
  evidence: string;
}): string {
  const { deckTitle, ticker, outline, templateMetaLine, inventory, evidence } = params;
  const titles = outline.sections.map((s) => s.title);
  return `
# CREDIT DECK REQUEST
Deck title: ${deckTitle}
Ticker: ${ticker}

# SLIDE TITLES (use EXACTLY these strings, in this order — one slide per line)
${titles.map((t, i) => `${i + 1}. ${t}`).join("\n")}

${templateMetaLine ? `# OUTLINE SOURCE\n${templateMetaLine}\n` : ""}
# FOLDER NOTE
${outline.sourceNotes}

# FILE INVENTORY
${inventory}

# EVIDENCE
${evidence}

---
Return ONLY the JSON object with a "slides" array. Each item's "title" must exactly match one of the numbered titles above, in order.`.trim();
}

export async function runCreditDeckGeneration(params: {
  userId: string;
  project: CreditMemoProject;
  targetWords: number;
  deckTitle: string;
  provider: AiProvider;
  useTemplate?: boolean;
  models: CreditMemoResolvedModels;
  apiKeys: LlmCallApiKeys;
  responseVerbosity?: ResponseVerbosity;
}): Promise<
  | { ok: true; outline: MemoOutline; buffer: Buffer; filename: string }
  | { ok: false; error: string }
> {
  const cfg = loadCreditMemoConfig();
  const ai = params.provider;
  if (!isProviderConfigured(ai, params.apiKeys)) {
    return { ok: false, error: USER_LLM_KEY_SETTINGS_HINT };
  }

  if (params.project.sources.length === 0) {
    return { ok: false, error: "No sources ingested. Run ingest after selecting a folder with files." };
  }

  let outline = planMemoOutline(params.targetWords, params.project.sources);
  let templateMetaLine = "";
  if (params.useTemplate) {
    const tpl = await getActiveCreditMemoTemplate(params.userId);
    if (tpl && tpl.outlineTitles.length > 0) {
      outline = planMemoOutlineFromTemplate({
        targetWords: params.targetWords,
        sources: params.project.sources,
        templateTitles: tpl.outlineTitles,
      });
      templateMetaLine = `DOCX template: ${tpl.filename} (${tpl.uploadedAt})`;
    } else {
      templateMetaLine = "Template outline requested but no template is configured (using default credit memo sections).";
    }
  }

  const inventory = formatSourceInventoryList(params.project.sources);
  const PROMPT_TOKEN_LIMIT =
    ai === "openai" || ai === "gemini" || ai === "deepseek" ? 190_000 : 180_000;
  const SYSTEM_TOKEN_EST = estimateTokensFromChars(DECK_SYSTEM.length);

  let maxEvidenceChars = cfg.maxContextChars;
  const evidenceQuery =
    `${params.deckTitle}\n${outline.sections.map((s) => s.title).join("\n")}\n${outline.sourceNotes}`.trim();
  let evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: evidenceQuery });
  let user = buildDeckUserPrompt({
    deckTitle: params.deckTitle,
    ticker: params.project.ticker,
    outline,
    templateMetaLine,
    inventory,
    evidence,
  });

  for (let i = 0; i < 8; i++) {
    const est = SYSTEM_TOKEN_EST + estimateTokensFromChars(user.length);
    if (est <= PROMPT_TOKEN_LIMIT) break;
    maxEvidenceChars = Math.max(40_000, Math.floor(maxEvidenceChars * 0.8));
    evidence = buildEvidencePackSync(params.project, { maxChars: maxEvidenceChars, query: evidenceQuery });
    user = buildDeckUserPrompt({
      deckTitle: params.deckTitle,
      ticker: params.project.ticker,
      outline,
      templateMetaLine,
      inventory,
      evidence,
    });
  }

  const { claudeModel, openaiModel, geminiModel, deepseekModel } = params.models;

  const deckMaxTokens = Math.min(12_000, Math.max(4_000, cfg.maxOutputTokens));

  const result = await llmCompleteSingle(ai, DECK_SYSTEM, user, {
    maxTokens: deckMaxTokens,
    claudeModel,
    openaiModel,
    geminiModel,
    deepseekModel,
    apiKeys: params.apiKeys,
    responseVerbosity: params.responseVerbosity,
  });

  if (!result.ok) {
    return { ok: false, error: result.error || "LLM request failed" };
  }

  let parsedRows: Array<{ title: string; bullets: string[] }>;
  try {
    parsedRows = parseDeckJson(result.text);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not parse deck JSON from model output.",
    };
  }

  const slides = alignSlidesToOutline(outline, parsedRows);

  let buffer: Buffer;
  try {
    buffer = await buildCreditDeckPptxBuffer({
      deckTitle: params.deckTitle,
      ticker: params.project.ticker,
      slides,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Failed to build PowerPoint file.",
    };
  }

  const safeTicker = params.project.ticker.replace(/[^a-zA-Z0-9-_]/g, "_");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  const filename = `${safeTicker}-credit-deck-draft-${stamp}.pptx`;

  return { ok: true, outline, buffer, filename };
}
