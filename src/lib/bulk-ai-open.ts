/**
 * Bulk research prompts via API (company bar) and shared prompt collection for those runs.
 */

import {
  buildCreditAgreementsFindDocsAiPrompt,
  PROMPT_TEMPLATE as CREDIT_AGREEMENTS_FIND_DOCS_TEMPLATE,
} from "@/lib/credit-agreements-prompts";
import { buildCompanyHistoryAiPrompt, PROMPT_TEMPLATE as COMPANY_HISTORY_PROMPT_TEMPLATE } from "@/components/CompanyHistoryTab";
import { buildCreditTimelineAiPrompt, CREDIT_TIMELINE_PROMPT_TEMPLATE } from "@/components/CompanyCreditTimelineTab";
import { BUSINESS_MODEL_PROMPT_TEMPLATE } from "@/data/business-model-prompt";
import {
  CAPITAL_STRUCTURE_PROMPT_TEMPLATE,
  resolveCapitalStructurePrompt,
} from "@/data/capital-structure-prompt";
import { COMPETITORS_PROMPT_TEMPLATE } from "@/data/competitors-prompt";
import {
  COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE,
  fillCompetitorEarningsReadThrusPrompt,
} from "@/data/competitor-earnings-readthrus-prompt";
import { CUSTOMERS_PROMPT_TEMPLATE } from "@/data/customers-prompt";
import { SUPPLIERS_PROMPT_TEMPLATE } from "@/data/suppliers-prompt";
import { EMPLOYEE_CONTACTS_PROMPT_TEMPLATE } from "@/data/employee-contacts-prompt";
import {
  fillHistoricalFinancialsPromptPlaceholders,
  HISTORICAL_FINANCIALS_PROMPT_TEMPLATE,
} from "@/data/historical-financials-prompt";
import { INDUSTRY_CONTACTS_PROMPT_TEMPLATE } from "@/data/industry-contacts-prompt";
import { INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE } from "@/data/industry-publications-prompt";
import {
  INDUSTRY_VALUE_CHAIN_PROMPT_TEMPLATE,
  resolveIndustryValueChainTemplate,
} from "@/data/industry-value-chain-prompt";
import { MANAGEMENT_BOARD_PROMPT_TEMPLATE } from "@/data/management-board-prompt";
import { MGMT_PRESENTATIONS_PROMPT_TEMPLATE } from "@/data/mgmt-presentations-prompt";
import { OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE } from "@/data/out-of-the-box-ideas-prompt";
import { CAPITAL_ALLOCATION_PROMPT_TEMPLATE } from "@/data/capital-allocation-prompt";
import { OVERVIEW_PROMPT_TEMPLATE } from "@/data/overview-prompt";
import {
  HOW_STUFF_WORKS_PROMPT_TEMPLATE,
  fillHowStuffWorksPromptPlaceholders,
} from "@/data/how-stuff-works-prompt";
import { RISK_FROM_10K_PROMPT_TEMPLATE } from "@/data/risk-from-10k-prompt";
import { BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE } from "@/data/business-risk-analysis-prompt";
import { COMPANY_REPUTATION_PROMPT_TEMPLATE } from "@/data/company-reputation-prompt";
import { ORG_CHART_PROMPT_TEMPLATE, ORG_CHART_SAMPLE_IMAGE_PATHS, resolveOrgChartTemplate } from "@/data/org-chart-prompt";
import { INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE } from "@/data/industry-history-drivers-prompt";
import { PORTERS_FIVE_FORCES_PROMPT_TEMPLATE } from "@/data/porters-five-forces-prompt";
import { RECENT_EVENTS_PROMPT_TEMPLATE } from "@/data/recent-events-prompt";
import { RESEARCH_ROADMAP_PROMPT_TEMPLATE } from "@/data/research-roadmap-prompt";
import { STARTUP_RISKS_PROMPT_TEMPLATE } from "@/data/startup-risks-prompt";
import { AI_RISK_PROMPT_TEMPLATE } from "@/data/ai-risk-prompt";
import { SUBSIDIARY_LIST_PROMPT_TEMPLATE } from "@/data/subsidiary-list-prompt";
import {
  modelOverridePayloadForProvider,
  type ModelRunChoice,
  modelPayloadForRun,
} from "@/lib/ai-model-prefs-client";
import type { AiProvider } from "@/lib/ai-provider";
import { saveToServer, type SavedDataKey } from "@/lib/saved-data-client";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import { fillCompanyPromptTemplate, resolveCompanyPromptLabels } from "@/lib/company-prompt-labels";
import { readPromptTemplateOverride } from "@/lib/prompt-template-storage";
import { extractXlsxArrayBufferFromApiText } from "@/lib/extract-xlsx-from-api-text";
import { pickCreditDocUrlForCategory } from "@/lib/bulk-credit-doc-match";
import { BULK_CREDIT_DOC_CATEGORY_STEPS } from "@/lib/bulk-credit-doc-match";
import type { CreditDocSavedBoxKey } from "@/lib/credit-doc-save-targets";
import { CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS } from "@/data/capital-structure-prompt";
import type { WorkProductPromptKind } from "@/lib/work-product-prompt-build";
import { fetchSavedTabContent } from "@/lib/saved-data-client";
import { ensureQuarterlyEarningsPackageForBulk } from "@/lib/bulk-earnings-package";
import { readFetchJson } from "@/lib/fetch-json-response";
import {
  countBulkStepsToRun,
  shouldSkipBulkStep,
  type BulkUpdateRunOptions,
} from "@/lib/bulk-update-preflight";

export type { BulkUpdateMode, BulkStepPreflight, BulkUpdateRunOptions } from "@/lib/bulk-update-preflight";

export type BulkOpenContext = {
  ticker: string;
  companyName: string | null | undefined;
  appOrigin: string;
};

function promptLabels(ctx: BulkOpenContext) {
  return resolveCompanyPromptLabels({ workspaceKey: ctx.ticker, companyName: ctx.companyName });
}

export type BulkPromptEntry = { label: string; prompt: string; saveKey: SavedDataKey };

export type BulkExcelTarget = "capital-structure" | "org-chart";

export type BulkUpdateStep =
  | {
      type: "prompt";
      label: string;
      saveKey: SavedDataKey;
      prompt: string;
      systemPrompt?: string;
      samplePublicPaths?: readonly string[];
    }
  | {
      type: "excel-prompt";
      label: string;
      target: BulkExcelTarget;
      prompt: string;
      samplePublicPaths?: readonly string[];
    }
  | {
      type: "credit-doc-analyze";
      label: string;
      saveKey: CreditDocSavedBoxKey;
      category: CreditDocSavedBoxKey;
    }
  | { type: "entity-mapper"; label: string }
  | { type: "earnings-package"; label: string }
  | {
      type: "work-product";
      label: string;
      kind: WorkProductPromptKind;
      saveKey: SavedDataKey;
      includeCompanyName?: boolean;
    }
  | { type: "ai-memo"; label: string; saveKey: SavedDataKey };

export function buildBulkCapitalStructurePrompt(ctx: BulkOpenContext): string {
  const tk = ctx.ticker.trim();
  const ov = readPromptTemplateOverride;
  return resolveCapitalStructurePrompt({
    template: ov("capital-structure", CAPITAL_STRUCTURE_PROMPT_TEMPLATE),
    ticker: tk,
    companyName: ctx.companyName,
    appOrigin: ctx.appOrigin || "",
  });
}

export function buildBulkOrgChartPrompt(ctx: BulkOpenContext): string {
  const tk = ctx.ticker.trim();
  const ov = readPromptTemplateOverride;
  return resolveOrgChartTemplate(ov("org-chart", ORG_CHART_PROMPT_TEMPLATE), {
    ticker: tk,
    companyName: ctx.companyName,
    appOrigin: ctx.appOrigin || "",
  });
}

export function buildBulkCreditDocsListPrompt(ctx: BulkOpenContext): string {
  const { tickerForPrompt } = promptLabels(ctx);
  const ov = readPromptTemplateOverride;
  return buildCreditAgreementsFindDocsAiPrompt(
    tickerForPrompt,
    ov("credit-agreements-find-docs", CREDIT_AGREEMENTS_FIND_DOCS_TEMPLATE)
  );
}

/** Research tabs only (excludes credit-docs list, Excel tabs, and credit-doc review — those run in dedicated bulk steps). */
export function collectBulkResearchPromptEntries(ctx: BulkOpenContext): BulkPromptEntry[] {
  const tk = ctx.ticker.trim();
  if (!tk) return [];
  const labels = promptLabels(ctx);
  const { displayName: dn, tickerForPrompt, parenLabel: labelParen } = labels;
  const fill = (template: string) => fillCompanyPromptTemplate(template, tk, ctx.companyName);
  const ov = readPromptTemplateOverride;
  const entries: BulkPromptEntry[] = [
    {
      label: "Business overview",
      saveKey: "overview",
      prompt: fill(ov("business-overview", OVERVIEW_PROMPT_TEMPLATE)),
    },
    {
      label: "Recent events",
      saveKey: "recent-events",
      prompt: fill(ov("recent-events", RECENT_EVENTS_PROMPT_TEMPLATE)),
    },
    {
      label: "Business model",
      saveKey: "business-model",
      prompt: fill(ov("business-model", BUSINESS_MODEL_PROMPT_TEMPLATE)),
    },
    {
      label: "HowStuffWorks",
      saveKey: "how-stuff-works",
      prompt: fillHowStuffWorksPromptPlaceholders(ov("how-stuff-works", HOW_STUFF_WORKS_PROMPT_TEMPLATE), dn, tickerForPrompt),
    },
    {
      label: "Management & board",
      saveKey: "management-board",
      prompt: fill(ov("management-board", MANAGEMENT_BOARD_PROMPT_TEMPLATE)),
    },
    {
      label: "Research roadmap",
      saveKey: "research-roadmap",
      prompt: fill(ov("research-roadmap", RESEARCH_ROADMAP_PROMPT_TEMPLATE)),
    },
    {
      label: "Out-of-the-box ideas",
      saveKey: "out-of-the-box-ideas",
      prompt: fill(ov("out-of-the-box-ideas", OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE)),
    },
    {
      label: "Employee contacts",
      saveKey: "employee-contacts",
      prompt: fill(ov("employee-contacts", EMPLOYEE_CONTACTS_PROMPT_TEMPLATE)),
    },
    {
      label: "Industry contacts",
      saveKey: "industry-contacts",
      prompt: fill(ov("industry-contacts", INDUSTRY_CONTACTS_PROMPT_TEMPLATE)),
    },
    {
      label: "Industry publications",
      saveKey: "industry-publications",
      prompt: fill(ov("industry-publications", INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE)),
    },
    {
      label: "Subsidiary list",
      saveKey: "subsidiary-list",
      prompt: fill(ov("subsidiary-list", SUBSIDIARY_LIST_PROMPT_TEMPLATE)),
    },
    {
      label: "Competitors",
      saveKey: "competitors",
      prompt: ov("competitors", COMPETITORS_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, labelParen),
    },
    {
      label: "Competitor Earnings ReadThrus",
      saveKey: "competitor-earnings-readthrus",
      prompt: fillCompetitorEarningsReadThrusPrompt(
        ov("competitor-earnings-readthrus", COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE),
        tk,
        ctx.companyName
      ),
    },
    {
      label: "Customers",
      saveKey: "customers",
      prompt: fill(ov("customers", CUSTOMERS_PROMPT_TEMPLATE)),
    },
    {
      label: "Suppliers",
      saveKey: "suppliers",
      prompt: fill(ov("suppliers", SUPPLIERS_PROMPT_TEMPLATE)),
    },
    {
      label: "Porter's Five Forces",
      saveKey: "porters-five-forces",
      prompt: ov("porters-five-forces", PORTERS_FIVE_FORCES_PROMPT_TEMPLATE).replace(
        /\[COMPANY NAME \/ TICKER\]/g,
        labelParen
      ),
    },
    {
      label: "Industry History and Drivers",
      saveKey: "industry-history-drivers",
      prompt: fill(ov("industry-history-drivers", INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE)),
    },
    {
      label: "Industry Value Chain",
      saveKey: "industry-value-chain",
      prompt: resolveIndustryValueChainTemplate(
        ov("industry-value-chain", INDUSTRY_VALUE_CHAIN_PROMPT_TEMPLATE),
        tk,
        ctx.companyName
      ),
    },
    {
      label: "Startup risks",
      saveKey: "startup-risks",
      prompt: fill(ov("startup-risks", STARTUP_RISKS_PROMPT_TEMPLATE)),
    },
    {
      label: "AI Risk",
      saveKey: "ai-risk",
      prompt: fill(ov("ai-risk", AI_RISK_PROMPT_TEMPLATE)),
    },
    {
      label: "Risk from 10-K",
      saveKey: "risk-from-10k",
      prompt: fill(ov("risk-from-10k", RISK_FROM_10K_PROMPT_TEMPLATE)),
    },
    {
      label: "Business Risk Analysis",
      saveKey: "business-risk-analysis",
      prompt: fill(ov("business-risk-analysis", BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE)),
    },
    {
      label: "Company Reputation",
      saveKey: "company-reputation",
      prompt: fill(ov("company-reputation", COMPANY_REPUTATION_PROMPT_TEMPLATE)),
    },
    {
      label: "Mgmt Presentations & Transcripts",
      saveKey: "presentations",
      prompt: ov("presentations", MGMT_PRESENTATIONS_PROMPT_TEMPLATE)
        .replace(/\{\{TICKER\}\}/g, tickerForPrompt)
        .replace(/\{\{COMPANY_NAME\}\}/g, dn),
    },
    {
      label: "Historical financials",
      saveKey: "historical-financials-prompt",
      prompt: fillHistoricalFinancialsPromptPlaceholders(HISTORICAL_FINANCIALS_PROMPT_TEMPLATE, dn, tickerForPrompt),
    },
    {
      label: "Credit timeline",
      saveKey: "credit-timeline",
      prompt: buildCreditTimelineAiPrompt(tk, ov("credit-timeline", CREDIT_TIMELINE_PROMPT_TEMPLATE)),
    },
    {
      label: "Company history",
      saveKey: "company-history",
      prompt: buildCompanyHistoryAiPrompt(tk, ctx.companyName, ov("company-history", COMPANY_HISTORY_PROMPT_TEMPLATE)),
    },
    {
      label: "Capital allocation",
      saveKey: "capital-allocation",
      prompt: fill(ov("capital-allocation", CAPITAL_ALLOCATION_PROMPT_TEMPLATE)),
    },
  ];
  return entries.filter((e) => e.prompt.trim().length > 0);
}

/** @deprecated Use `collectBulkUpdateSteps` for the full pipeline. */
export function collectBulkClaudePromptEntries(ctx: BulkOpenContext): BulkPromptEntry[] {
  return collectBulkResearchPromptEntries(ctx);
}

export function collectBulkUpdateSteps(ctx: BulkOpenContext): BulkUpdateStep[] {
  const tk = ctx.ticker.trim();
  if (!tk) return [];

  const steps: BulkUpdateStep[] = [];
  for (const e of collectBulkResearchPromptEntries(ctx)) {
    steps.push({ type: "prompt", label: e.label, saveKey: e.saveKey, prompt: e.prompt });
  }

  steps.push({
    type: "prompt",
    label: "Credit Docs List",
    saveKey: "credit-agreements-indentures-other",
    prompt: buildBulkCreditDocsListPrompt(ctx),
  });

  steps.push({
    type: "excel-prompt",
    label: "Capital structure (Excel)",
    target: "capital-structure",
    prompt: buildBulkCapitalStructurePrompt(ctx),
    samplePublicPaths: CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS,
  });

  steps.push({
    type: "excel-prompt",
    label: "Org chart (Excel)",
    target: "org-chart",
    prompt: buildBulkOrgChartPrompt(ctx),
    samplePublicPaths: ORG_CHART_SAMPLE_IMAGE_PATHS,
  });

  for (const cat of BULK_CREDIT_DOC_CATEGORY_STEPS) {
    steps.push({
      type: "credit-doc-analyze",
      label: cat.label,
      saveKey: cat.category,
      category: cat.category,
    });
  }

  steps.push({ type: "entity-mapper", label: "Entity Mapper" });

  steps.push({
    type: "earnings-package",
    label: "Quarterly earnings package (2 yrs)",
  });

  const workProducts: Array<{
    kind: WorkProductPromptKind;
    label: string;
    saveKey: SavedDataKey;
    includeCompanyName?: boolean;
  }> = [
    { kind: "kpi", label: "KPI Commentary", saveKey: "kpi-latest", includeCompanyName: true },
    { kind: "forensic", label: "Forensic Accounting", saveKey: "forensic-accounting-latest", includeCompanyName: true },
    { kind: "lme", label: "LME Analysis", saveKey: "lme-analysis" },
    { kind: "recommendation", label: "Cap Structure Recommendation", saveKey: "cs-recommendation-latest" },
    { kind: "literary", label: "Literary References", saveKey: "literary-references-latest" },
    { kind: "biblical", label: "Biblical References", saveKey: "biblical-references-latest" },
    { kind: "dumbass", label: "Shorting at 50c", saveKey: "how-to-look-like-a-dumbass-latest" },
    { kind: "earnings-transcript", label: "Earnings Transcript", saveKey: "next-quarter-earnings-transcript-latest" },
  ];

  for (const wp of workProducts) {
    steps.push({
      type: "work-product",
      label: wp.label,
      kind: wp.kind,
      saveKey: wp.saveKey,
      includeCompanyName: wp.includeCompanyName,
    });
  }

  steps.push({ type: "ai-memo", label: "AI Credit Memo", saveKey: "ai-credit-memo-latest" });

  return steps;
}

/**
 * Wait between bulk tab calls so we stay under provider RPM/TPM (450ms was far too aggressive).
 * ~6 calls/min sustained; rate-limit retries back off further when providers still throttle.
 */
const BULK_API_STAGGER_MS = 10_000;

/** Retries for each tab: rate limits, 5xx, timeouts, and flaky network. */
const BULK_API_MAX_ATTEMPTS = 5;

const SAVE_RETRIES = 3;
const SAVE_RETRY_BASE_MS = 1_200;

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimitError(httpStatus: number, message: string): boolean {
  if (httpStatus === 429) return true;
  const m = message.toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("resource exhausted") ||
    m.includes("quota exceeded")
  );
}

/** True when a failed attempt is worth retrying (transient / overloaded). */
function isRetryableBulkError(httpStatus: number, message: string): boolean {
  if (isRateLimitError(httpStatus, message)) return true;
  if (httpStatus === 502 || httpStatus === 503 || httpStatus === 504) return true;
  if (httpStatus >= 500 && httpStatus <= 599) return true;
  const m = message.toLowerCase();
  return (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("econnreset") ||
    m.includes("socket") ||
    m.includes("fetch failed") ||
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("bad gateway") ||
    m.includes("service unavailable") ||
    m.includes("gateway time-out") ||
    m.includes("overloaded") ||
    m.includes("try again")
  );
}

function isNonRetryableHttpStatus(status: number): boolean {
  return status === 400 || status === 401 || status === 403 || status === 404 || status === 413;
}

function bulkAttemptBackoffMs(attemptIndex: number): number {
  return 12_000 + attemptIndex * 10_000;
}

/**
 * `saveToServer` can fail briefly (DB connection, host blip) while the model output is valid — retry a few times.
 */
async function saveToServerWithRetries(
  ticker: string,
  key: Parameters<typeof saveToServer>[1],
  content: string
): Promise<boolean> {
  for (let s = 0; s < SAVE_RETRIES; s++) {
    const ok = await saveToServer(ticker, key, content);
    if (ok) return true;
    if (s < SAVE_RETRIES - 1) {
      await delay(SAVE_RETRY_BASE_MS * (s + 1));
    }
  }
  return false;
}

export type BulkApiProgress = { index: number; total: number; label: string };

async function completeTabPrompt(params: {
  provider: AiProvider;
  userPrompt: string;
  systemPrompt?: string;
  samplePublicPaths?: readonly string[];
  modelPayload: Record<string, unknown>;
  researchSaveKey?: string;
  workProductKind?: WorkProductPromptKind;
}): Promise<string> {
  let lastErr = "";
  for (let attempt = 0; attempt < BULK_API_MAX_ATTEMPTS; attempt++) {
    let res: Response;
    let data: { ok?: boolean; text?: string; error?: string };
    try {
      res = await fetch("/api/tab-prompt-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: params.provider,
          userPrompt: params.userPrompt.trim(),
          systemPrompt: params.systemPrompt?.trim() || undefined,
          maxTokens: LLM_MAX_OUTPUT_TOKENS,
          samplePublicPaths: params.samplePublicPaths,
          researchSaveKey: params.researchSaveKey,
          workProductKind: params.workProductKind,
          ...params.modelPayload,
        }),
      });
      data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
    } catch (netErr) {
      lastErr = netErr instanceof Error ? netErr.message : String(netErr);
      if (attempt < BULK_API_MAX_ATTEMPTS - 1 && isRetryableBulkError(0, lastErr)) {
        await delay(bulkAttemptBackoffMs(attempt));
        continue;
      }
      throw new Error(lastErr);
    }

    if (res.ok && data.ok === true && typeof data.text === "string") {
      return data.text.trim();
    }

    lastErr = data.error || `Request failed (${res.status})`;
    if (isNonRetryableHttpStatus(res.status)) throw new Error(lastErr);
    if (isRetryableBulkError(res.status, lastErr) && attempt < BULK_API_MAX_ATTEMPTS - 1) {
      await delay(bulkAttemptBackoffMs(attempt));
      continue;
    }
    throw new Error(lastErr);
  }
  throw new Error(lastErr || "Prompt completion failed");
}

async function saveExcelFromApiText(
  ticker: string,
  text: string,
  target: BulkExcelTarget
): Promise<boolean> {
  const buf = extractXlsxArrayBufferFromApiText(text);
  if (!buf) return false;
  const filename = `${ticker}-${target === "capital-structure" ? "capital-structure" : "org-chart"}-bulk-api.xlsx`;
  const apiBase =
    target === "capital-structure" ? "/api/capital-structure-excel" : "/api/org-chart-excel";
  const blob = new Blob([buf], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("filename", filename);
  const res = await fetch(`${apiBase}/${encodeURIComponent(ticker)}`, { method: "POST", body: form });
  const body = await readFetchJson<{ ok?: boolean }>(res, `${target} Excel upload`);
  return res.ok && body.ok === true;
}

let creditDocsListCache: string | null = null;

async function loadCreditDocsListContent(ticker: string): Promise<string> {
  if (creditDocsListCache?.trim()) return creditDocsListCache;
  const loaded = await fetchSavedTabContent(ticker, "credit-agreements-indentures-other");
  creditDocsListCache = loaded;
  return loaded;
}

async function runEntityMapperBulk(
  ticker: string,
  provider: AiProvider,
  companyName: string | null | undefined,
  modelPayload: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/entity-mapper/${encodeURIComponent(ticker)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      companyName: companyName?.trim() || undefined,
      discoverSecDocuments: true,
      downloadExhibitsToSavedDocs: false,
      maxSavedDocumentDownloads: 80,
      compactResponse: true,
      ...modelPayload,
    }),
  });
  const body = await readFetchJson<{ ok?: boolean; error?: string }>(res, "Entity Mapper");
  if (!res.ok || body.ok === false) throw new Error(body.error ?? "Entity Mapper failed");
}

async function runWorkProductBulk(params: {
  ticker: string;
  kind: WorkProductPromptKind;
  companyName: string | null | undefined;
  includeCompanyName?: boolean;
  provider: AiProvider;
  modelPayload: Record<string, unknown>;
}): Promise<string> {
  const buildRes = await fetch(
    `/api/work-product-prompt/${encodeURIComponent(params.kind)}/${encodeURIComponent(params.ticker)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: params.includeCompanyName ? params.companyName?.trim() ?? "" : "",
      }),
    }
  );
  const built = (await buildRes.json()) as {
    ok?: boolean;
    error?: string;
    systemPrompt?: string;
    userPrompt?: string;
  };
  if (!buildRes.ok || !built.ok) {
    throw new Error(built.error ?? "Failed to build work-product context window");
  }
  return completeTabPrompt({
    provider: params.provider,
    systemPrompt: built.systemPrompt,
    userPrompt: built.userPrompt ?? "",
    modelPayload: params.modelPayload,
    workProductKind: params.kind,
  });
}

async function runAiMemoBulk(params: {
  ticker: string;
  companyName: string | null | undefined;
  provider: AiProvider;
  modelPayload: Record<string, unknown>;
}): Promise<string> {
  const resolveRes = await fetch("/api/credit-memo/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker: params.ticker }),
  });
  const resolved = (await resolveRes.json()) as {
    ok?: boolean;
    error?: string;
    chosen?: { path?: string };
    resolutionMeta?: unknown;
  };
  const folderPath = resolved.chosen?.path?.trim();
  if (!resolveRes.ok || !resolved.ok || !folderPath) {
    throw new Error(resolved.error ?? "Could not resolve research folder for memo ingest");
  }

  const projectRes = await fetch("/api/credit-memo/project", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ticker: params.ticker,
      folderPath,
      resolutionMeta: resolved.resolutionMeta ?? { folderPath },
      workProductIngestScope: "memo",
    }),
  });
  const projectBody = (await projectRes.json()) as {
    ok?: boolean;
    error?: string;
    project?: { id: string };
  };
  if (!projectRes.ok || !projectBody.project?.id) {
    throw new Error(projectBody.error ?? "Memo source ingest failed");
  }

  const memoTitle = `${params.ticker.toUpperCase()} — Credit Memo`;
  const promptRes = await fetch(
    `/api/credit-memo/project/${encodeURIComponent(projectBody.project.id)}/memo-prompt`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ targetWords: 10_000, memoTitle, useTemplate: true }),
    }
  );
  const promptBody = (await promptRes.json()) as {
    ok?: boolean;
    error?: string;
    systemPrompt?: string;
    userPrompt?: string;
  };
  if (!promptRes.ok || !promptBody.ok) {
    throw new Error(promptBody.error ?? "Failed to build memo context window");
  }

  return completeTabPrompt({
    provider: params.provider,
    systemPrompt: promptBody.systemPrompt,
    userPrompt: promptBody.userPrompt ?? "",
    modelPayload: params.modelPayload,
    researchSaveKey: "ai-credit-memo-latest",
  });
}

/**
 * Runs the full bulk pipeline through the server LLM API and writes answers to saved tab slots.
 */
export async function runBulkUpdateViaApi(
  ctx: BulkOpenContext,
  provider: AiProvider,
  onProgress?: (p: BulkApiProgress) => void,
  /** If omitted, uses the same per-provider payload as `modelOverridePayloadForProvider` (saved prefs). */
  modelChoice?: ModelRunChoice,
  options?: BulkUpdateRunOptions
): Promise<{ ok: number; fail: number; errors: string[]; skipped: number; skippedExisting: number }> {
  creditDocsListCache = null;
  const modelPayload =
    modelChoice !== undefined ? modelPayloadForRun(provider, modelChoice) : modelOverridePayloadForProvider(provider);
  const stepsAll = collectBulkUpdateSteps(ctx);
  const tk = ctx.ticker.trim();
  const errors: string[] = [];
  if (!tk) return { ok: 0, fail: 0, errors: [], skipped: 0, skippedExisting: 0 };

  const mode = options?.mode ?? "overwrite-all";
  const preflight = options?.preflight;
  const refreshWorkProducts = options?.refreshWorkProducts ?? mode === "missing-only";
  const stepsToRunCount =
    preflight && preflight.length === stepsAll.length
      ? countBulkStepsToRun(stepsAll, preflight, mode, refreshWorkProducts)
      : stepsAll.length;

  let ok = 0;
  let fail = 0;
  let skipped = 0;
  let skippedExisting = 0;
  let runIndex = 0;

  for (let i = 0; i < stepsAll.length; i++) {
    const step = stepsAll[i]!;

    if (shouldSkipBulkStep(step, preflight?.[i], mode, refreshWorkProducts)) {
      skippedExisting++;
      continue;
    }

    runIndex++;
    onProgress?.({ index: runIndex, total: stepsToRunCount, label: step.label });

    try {
      if (step.type === "prompt") {
        const text = await completeTabPrompt({
          provider,
          userPrompt: step.prompt,
          systemPrompt: step.systemPrompt,
          samplePublicPaths: step.samplePublicPaths,
          modelPayload,
          researchSaveKey: step.saveKey,
        });
        const saved = await saveToServerWithRetries(tk, step.saveKey, text);
        if (!saved) {
          fail++;
          errors.push(`${step.label}: model replied but save failed after retries`);
        } else {
          ok++;
          if (step.saveKey === "credit-agreements-indentures-other") {
            creditDocsListCache = text;
          }
        }
      } else if (step.type === "excel-prompt") {
        const text = await completeTabPrompt({
          provider,
          userPrompt: step.prompt,
          samplePublicPaths: step.samplePublicPaths,
          modelPayload,
          researchSaveKey: step.target === "capital-structure" ? "capital-structure" : "org-chart-prompt",
        });
        const excelSaved = await saveExcelFromApiText(tk, text, step.target);
        if (!excelSaved) {
          fail++;
          errors.push(
            `${step.label}: API finished but no embedded .xlsx found — upload Excel manually on that tab`
          );
        } else {
          ok++;
        }
      } else if (step.type === "credit-doc-analyze") {
        const listContent = await loadCreditDocsListContent(tk);
        const match = pickCreditDocUrlForCategory(listContent, step.category);
        if (!match) {
          skipped++;
          errors.push(`${step.label}: skipped — no matching row in Credit Docs List`);
          continue;
        }
        onProgress?.({ index: runIndex, total: stepsToRunCount, label: `${step.label} — ${match.row.label || match.url}` });
        const res = await fetch(`/api/bulk-credit-doc-analyze/${encodeURIComponent(tk)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            url: match.url,
            saveKey: step.saveKey,
            ...modelPayload,
          }),
        });
        const body = await readFetchJson<{ ok?: boolean; error?: string }>(
          res,
          `${step.label} analysis`
        );
        if (!res.ok || !body.ok) throw new Error(body.error ?? "Credit doc analysis failed");
        ok++;
      } else if (step.type === "entity-mapper") {
        await runEntityMapperBulk(tk, provider, ctx.companyName, modelPayload);
        ok++;
      } else if (step.type === "earnings-package") {
        const earningsResult = await ensureQuarterlyEarningsPackageForBulk(
          tk,
          ctx.companyName,
          (detail) => {
            onProgress?.({ index: runIndex, total: stepsToRunCount, label: `${step.label} — ${detail}` });
          }
        );
        if (earningsResult === "skipped") {
          skipped++;
        } else {
          ok++;
        }
      } else if (step.type === "work-product") {
        const text = await runWorkProductBulk({
          ticker: tk,
          kind: step.kind,
          companyName: ctx.companyName,
          includeCompanyName: step.includeCompanyName,
          provider,
          modelPayload,
        });
        const saved = await saveToServerWithRetries(tk, step.saveKey, text);
        if (!saved) {
          fail++;
          errors.push(`${step.label}: model replied but save failed after retries`);
        } else {
          ok++;
        }
      } else if (step.type === "ai-memo") {
        const text = await runAiMemoBulk({
          ticker: tk,
          companyName: ctx.companyName,
          provider,
          modelPayload,
        });
        const saved = await saveToServerWithRetries(tk, step.saveKey, text);
        if (!saved) {
          fail++;
          errors.push(`${step.label}: model replied but save failed after retries`);
        } else {
          ok++;
        }
      }
    } catch (err) {
      fail++;
      errors.push(`${step.label}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (runIndex < stepsToRunCount) {
      await delay(BULK_API_STAGGER_MS);
    }
  }

  return { ok, fail, errors, skipped, skippedExisting };
}

