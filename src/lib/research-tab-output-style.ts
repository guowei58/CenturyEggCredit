import { generatedWorkProductTabDataKeys } from "@/lib/kpi-workspace-sources";
import {
  EXCEL_API_DELIVERABLE_SYSTEM,
  EXCEL_API_DELIVERABLE_USER_BLOCK,
  isExcelApiDeliverableSaveKey,
} from "@/lib/excel-api-deliverable";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";

export type ResearchTabOutputLayer =
  | "canon"
  | "delta"
  | "credit-doc"
  | "work-product"
  | "creative"
  | "excel-deliverable"
  | "none";

/** Tabs that establish shared company/industry baseline (full depth allowed). */
export const CANON_RESEARCH_SAVE_KEYS = new Set<string>([
  "overview",
  "business-model",
  "how-stuff-works",
  "industry-history-drivers",
  "industry-value-chain",
  "porters-five-forces",
]);

const CREATIVE_WORK_PRODUCT_KINDS = new Set<WorkProductPromptKind>([
  "literary",
  "biblical",
  "dumbass",
  "earnings-transcript",
]);

const WORK_PRODUCT_SAVE_KEYS = generatedWorkProductTabDataKeys();

const STYLE_MARKER = "output style (required)";

const CANON_USER_BLOCK = `
Research output style (required):
- This tab is a **canon** tab: establish the shared baseline for this issuer (what it does, how it makes money, industry context).
- Use tables and bullets for facts; keep narrative tight.
- Go deep on facts and numbers, but avoid investor-relations fluff and generic industry tutorials unrelated to this issuer.
`.trim();

const DELTA_USER_BLOCK = `
Research output style (required):
- This is a **delta** tab: assume the reader already has Overview, Business Model, How Stuff Works, and Industry tabs for this issuer.
- Do **not** open with company description, segment mix recap, industry primer, or executive summary unless the prompt explicitly requires one.
- Start each requested section with the **direct answer** (tables, bullets, numbers, dates). Put supporting mechanism or quotes after the fact block.
- Only restate baseline context when correcting prior material or introducing a **new** data point not covered elsewhere.
- If extra detail does not fit a table row, use \`Appendix: additional evidence\` — never as an opening paragraph.
`.trim();

const CREDIT_DOC_USER_BLOCK = `
Research output style (required):
- Analyze the **document text** only. Do not open with issuer overview, industry background, or capital-structure recap.
- Begin with covenant / structural findings, thresholds, and credit-relevant mechanics from the document.
- Use tables for baskets, ratios, definitions, and dates; cite section references where possible.
`.trim();

const WORK_PRODUCT_SYSTEM_BLOCK = `
Work-product output style (required):
- The source pack already contains company and industry background from other tabs. **Do not** re-introduce the issuer or restate obvious context.
- Begin immediately with the requested deliverable (KPI list, forensic finding, LME issue, recommendation, memo section, etc.).
- Prefer dense tables and bullets; preserve all credit-relevant facts and citations from sources.
`.trim();

const CREATIVE_SYSTEM_BLOCK = `
Creative output style (required):
- Prioritize the requested creative format. Do not open with a generic company overview or industry essay.
- Keep issuer references tight and purposeful.
`.trim();

export function isCreditDocResearchSaveKey(saveKey: string): boolean {
  return saveKey.startsWith("credit-agreements-indentures");
}

export function resolveResearchTabOutputLayer(opts: {
  researchSaveKey?: string | null;
  workProductKind?: WorkProductPromptKind | string | null;
  outputLayer?: ResearchTabOutputLayer | null;
}): ResearchTabOutputLayer {
  if (opts.outputLayer && opts.outputLayer !== "none") return opts.outputLayer;
  const kind = typeof opts.workProductKind === "string" ? opts.workProductKind.trim() : "";
  if (kind && CREATIVE_WORK_PRODUCT_KINDS.has(kind as WorkProductPromptKind)) return "creative";
  if (kind) return "work-product";
  const key = opts.researchSaveKey?.trim() ?? "";
  if (!key) return "none";
  if (isExcelApiDeliverableSaveKey(key)) return "excel-deliverable";
  if (CANON_RESEARCH_SAVE_KEYS.has(key)) return "canon";
  if (isCreditDocResearchSaveKey(key)) return "credit-doc";
  if (WORK_PRODUCT_SAVE_KEYS.has(key) || key.startsWith("ai-credit-memo")) return "work-product";
  return "delta";
}

function prependUserBlock(userPrompt: string, block: string): string {
  const trimmed = userPrompt.trim();
  if (!trimmed) return block;
  if (trimmed.toLowerCase().includes(STYLE_MARKER)) return trimmed;
  return `${block}\n\n---\n\n${trimmed}`;
}

function appendSystemBlock(systemPrompt: string, block: string): string {
  const trimmed = systemPrompt.trim();
  if (!trimmed) return block;
  if (trimmed.toLowerCase().includes(STYLE_MARKER)) return trimmed;
  return `${trimmed}\n\n${block}`;
}

/** Apply canon/delta/work-product output discipline to tab-prompt user/system messages. */
export function applyResearchTabPromptStyle(params: {
  userPrompt: string;
  systemPrompt?: string;
  researchSaveKey?: string | null;
  workProductKind?: WorkProductPromptKind | string | null;
  outputLayer?: ResearchTabOutputLayer | null;
}): { userPrompt: string; systemPrompt: string; layer: ResearchTabOutputLayer } {
  const layer = resolveResearchTabOutputLayer(params);
  let userPrompt = params.userPrompt.trim();
  let systemPrompt = params.systemPrompt?.trim() ?? "";

  switch (layer) {
    case "canon":
      userPrompt = prependUserBlock(userPrompt, CANON_USER_BLOCK);
      break;
    case "delta":
      userPrompt = prependUserBlock(userPrompt, DELTA_USER_BLOCK);
      break;
    case "credit-doc":
      userPrompt = prependUserBlock(userPrompt, CREDIT_DOC_USER_BLOCK);
      break;
    case "work-product":
      userPrompt = prependUserBlock(userPrompt, DELTA_USER_BLOCK);
      systemPrompt = appendSystemBlock(systemPrompt, WORK_PRODUCT_SYSTEM_BLOCK);
      break;
    case "creative":
      systemPrompt = appendSystemBlock(systemPrompt, CREATIVE_SYSTEM_BLOCK);
      break;
    case "excel-deliverable":
      userPrompt = prependUserBlock(userPrompt, EXCEL_API_DELIVERABLE_USER_BLOCK);
      systemPrompt = EXCEL_API_DELIVERABLE_SYSTEM;
      break;
    default:
      break;
  }

  return { userPrompt, systemPrompt, layer };
}
