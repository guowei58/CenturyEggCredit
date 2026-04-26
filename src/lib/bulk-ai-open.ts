/**
 * Bulk research prompts via API (company bar) and shared prompt collection for those runs.
 */

import {
  buildCreditAgreementsFindDocsAiPrompt,
  getCreditAgreementsDocReviewAiPrompt,
  PROMPT_TEMPLATE as CREDIT_AGREEMENTS_FIND_DOCS_TEMPLATE,
  DOC_REVIEW_PROMPT,
} from "@/components/CompanyCreditAgreementsIndenturesTab";
import { buildCompanyHistoryAiPrompt, PROMPT_TEMPLATE as COMPANY_HISTORY_PROMPT_TEMPLATE } from "@/components/CompanyHistoryTab";
import { buildCreditTimelineAiPrompt, CREDIT_TIMELINE_PROMPT_TEMPLATE } from "@/components/CompanyCreditTimelineTab";
import { BUSINESS_MODEL_PROMPT_TEMPLATE } from "@/data/business-model-prompt";
import { CAPITAL_STRUCTURE_PROMPT_TEMPLATE, resolveCapitalStructurePrompt } from "@/data/capital-structure-prompt";
import { COMPETITORS_PROMPT_TEMPLATE } from "@/data/competitors-prompt";
import { CUSTOMERS_PROMPT_TEMPLATE } from "@/data/customers-prompt";
import { SUPPLIERS_PROMPT_TEMPLATE } from "@/data/suppliers-prompt";
import { EARNINGS_RELEASES_PROMPT_TEMPLATE } from "@/data/earnings-releases-prompt";
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
import { ORG_CHART_PROMPT_TEMPLATE, resolveOrgChartTemplate } from "@/data/org-chart-prompt";
import { INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE } from "@/data/industry-history-drivers-prompt";
import { PORTERS_FIVE_FORCES_PROMPT_TEMPLATE } from "@/data/porters-five-forces-prompt";
import { RESEARCH_ROADMAP_PROMPT_TEMPLATE } from "@/data/research-roadmap-prompt";
import { STARTUP_RISKS_PROMPT_TEMPLATE } from "@/data/startup-risks-prompt";
import { SUBSIDIARY_LIST_PROMPT_TEMPLATE } from "@/data/subsidiary-list-prompt";
import {
  modelOverridePayloadForProvider,
  type ModelRunChoice,
  modelPayloadForRun,
} from "@/lib/ai-model-prefs-client";
import type { AiProvider } from "@/lib/ai-provider";
import { saveToServer, type SavedDataKey } from "@/lib/saved-data-client";
import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";
import { readPromptTemplateOverride } from "@/lib/prompt-template-storage";

export type BulkOpenContext = {
  ticker: string;
  companyName: string | null | undefined;
  appOrigin: string;
};

function displayName(ctx: BulkOpenContext): string {
  const tk = ctx.ticker.trim();
  return ctx.companyName?.trim() || tk || "";
}

/** "Acme (ACME)" when we have a real name; else ticker. */
function companyParenLabel(ctx: BulkOpenContext): string {
  const safeTicker = ctx.ticker.trim();
  const dn = displayName(ctx);
  return dn && dn.toUpperCase() !== safeTicker.toUpperCase() ? `${dn} (${safeTicker})` : safeTicker || dn;
}

function earningsCompanyNameLine(ctx: BulkOpenContext): string {
  const safeTicker = ctx.ticker.trim();
  const n = ctx.companyName?.trim();
  if (n && n.toUpperCase() !== safeTicker.toUpperCase()) return n;
  return "Not provided in app — infer from ticker, SEC, and IR.";
}

export type BulkPromptEntry = { label: string; prompt: string; saveKey: SavedDataKey };

export function collectBulkClaudePromptEntries(ctx: BulkOpenContext): BulkPromptEntry[] {
  const tk = ctx.ticker.trim();
  if (!tk) return [];
  const dn = displayName(ctx);
  const origin = ctx.appOrigin || "";
  const labelParen = companyParenLabel(ctx);
  const ov = readPromptTemplateOverride;
  const entries: BulkPromptEntry[] = [
    {
      label: "Business overview",
      saveKey: "overview",
      prompt: ov("business-overview", OVERVIEW_PROMPT_TEMPLATE).replace(/\[COMPANY NAME\]/g, dn).replace(/\[TICKER\]/g, tk),
    },
    {
      label: "Business model",
      saveKey: "business-model",
      prompt: ov("business-model", BUSINESS_MODEL_PROMPT_TEMPLATE).replace("[TICKER / COMPANY NAME]", `${tk} / ${dn}`),
    },
    {
      label: "HowStuffWorks",
      saveKey: "how-stuff-works",
      prompt: fillHowStuffWorksPromptPlaceholders(ov("how-stuff-works", HOW_STUFF_WORKS_PROMPT_TEMPLATE), dn, tk),
    },
    {
      label: "Management & board",
      saveKey: "management-board",
      prompt: ov("management-board", MANAGEMENT_BOARD_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, tk),
    },
    {
      label: "Research roadmap",
      saveKey: "research-roadmap",
      prompt: ov("research-roadmap", RESEARCH_ROADMAP_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, tk),
    },
    {
      label: "Out-of-the-box ideas",
      saveKey: "out-of-the-box-ideas",
      prompt: ov("out-of-the-box-ideas", OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, tk),
    },
    {
      label: "Employee contacts",
      saveKey: "employee-contacts",
      prompt: ov("employee-contacts", EMPLOYEE_CONTACTS_PROMPT_TEMPLATE)
        .replace(/\[INSERT TICKER\]/g, tk)
        .replace(/\[INSERT COMPANY NAME IF KNOWN\]/g, dn),
    },
    {
      label: "Industry contacts",
      saveKey: "industry-contacts",
      prompt: ov("industry-contacts", INDUSTRY_CONTACTS_PROMPT_TEMPLATE)
        .replace(/\[INSERT TICKER\]/g, tk)
        .replace(/\[INSERT COMPANY NAME\]/g, dn),
    },
    {
      label: "Industry publications",
      saveKey: "industry-publications",
      prompt: ov("industry-publications", INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE)
        .replace(/\[TICKER\]/g, tk)
        .replace(/\[COMPANY NAME\]/g, dn),
    },
    {
      label: "Subsidiary list",
      saveKey: "subsidiary-list",
      prompt: ov("subsidiary-list", SUBSIDIARY_LIST_PROMPT_TEMPLATE).replace(/\{\{TICKER\}\}/g, tk),
    },
    {
      label: "Competitors",
      saveKey: "competitors",
      prompt: ov("competitors", COMPETITORS_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, labelParen),
    },
    {
      label: "Customers",
      saveKey: "customers",
      prompt: ov("customers", CUSTOMERS_PROMPT_TEMPLATE)
        .replace(/\[INSERT TICKER\]/g, tk)
        .replace(/\[INSERT COMPANY NAME\]/g, dn),
    },
    {
      label: "Suppliers",
      saveKey: "suppliers",
      prompt: ov("suppliers", SUPPLIERS_PROMPT_TEMPLATE)
        .replace(/\[INSERT TICKER\]/g, tk)
        .replace(/\[INSERT COMPANY NAME\]/g, dn),
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
      prompt: ov("industry-history-drivers", INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE)
        .replace(/\[INSERT COMPANY NAME\]/g, dn)
        .replace(/\[INSERT TICKER\]/g, tk),
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
      prompt: ov("startup-risks", STARTUP_RISKS_PROMPT_TEMPLATE).replace(/\[TICKER\]/g, tk),
    },
    {
      label: "Risk from 10-K",
      saveKey: "risk-from-10k",
      prompt: ov("risk-from-10k", RISK_FROM_10K_PROMPT_TEMPLATE)
        .replace(/\[INSERT TICKER\]/g, tk)
        .replace(/\[INSERT COMPANY NAME\]/g, dn),
    },
    {
      label: "Earnings releases",
      saveKey: "earnings-releases",
      prompt: ov("earnings-releases", EARNINGS_RELEASES_PROMPT_TEMPLATE)
        .replace(/\{\{TICKER\}\}/g, tk)
        .replace(/\{\{COMPANY_NAME\}\}/g, earningsCompanyNameLine(ctx)),
    },
    {
      label: "Mgmt Presentations & Transcripts",
      saveKey: "presentations",
      prompt: ov("presentations", MGMT_PRESENTATIONS_PROMPT_TEMPLATE)
        .replace(/\{\{TICKER\}\}/g, tk)
        .replace(/\{\{COMPANY_NAME\}\}/g, dn),
    },
    {
      label: "Historical financials",
      saveKey: "historical-financials-prompt",
      prompt: fillHistoricalFinancialsPromptPlaceholders(HISTORICAL_FINANCIALS_PROMPT_TEMPLATE, dn, tk),
    },
    {
      label: "Capital structure",
      saveKey: "capital-structure",
      prompt: resolveCapitalStructurePrompt({
        template: ov("capital-structure", CAPITAL_STRUCTURE_PROMPT_TEMPLATE),
        ticker: tk,
        appOrigin: origin,
      }),
    },
    {
      label: "Org chart",
      saveKey: "org-chart-prompt",
      prompt: resolveOrgChartTemplate(ov("org-chart", ORG_CHART_PROMPT_TEMPLATE), {
        ticker: tk,
        companyName: ctx.companyName,
        appOrigin: origin,
      }),
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
      prompt: ov("capital-allocation", CAPITAL_ALLOCATION_PROMPT_TEMPLATE)
        .replace(/\[COMPANY NAME\]/g, dn)
        .replace(/\[TICKER\]/g, tk),
    },
    {
      label: "Credit agreements — find documents",
      saveKey: "credit-agreements-indentures-other",
      prompt: buildCreditAgreementsFindDocsAiPrompt(tk, ov("credit-agreements-find-docs", CREDIT_AGREEMENTS_FIND_DOCS_TEMPLATE)),
    },
    {
      label: "Credit agreements — doc review",
      saveKey: "credit-agreements-indentures-credit-agreement",
      prompt: getCreditAgreementsDocReviewAiPrompt(ov("credit-agreements-doc-review", DOC_REVIEW_PROMPT)),
    },
  ];
  return entries.filter((e) => e.prompt.trim().length > 0);
}

/**
 * Wait between bulk tab calls so we stay under provider RPM/TPM (450ms was far too aggressive).
 * ~6 calls/min sustained; rate-limit retries back off further when providers still throttle.
 */
const BULK_API_STAGGER_MS = 10_000;

const BULK_API_RATE_LIMIT_MAX_ATTEMPTS = 5;

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

export type BulkApiProgress = { index: number; total: number; label: string };

/**
 * Runs each bulk research prompt through the server LLM API, then writes the answer to the same
 * saved slot as the corresponding tab (server-backed save files).
 */
export async function runBulkUpdateViaApi(
  ctx: BulkOpenContext,
  provider: AiProvider,
  onProgress?: (p: BulkApiProgress) => void,
  /** If omitted, uses the same per-provider payload as `modelOverridePayloadForProvider` (saved prefs). */
  modelChoice?: ModelRunChoice
): Promise<{ ok: number; fail: number; errors: string[] }> {
  const modelPayload =
    modelChoice !== undefined ? modelPayloadForRun(provider, modelChoice) : modelOverridePayloadForProvider(provider);
  const entries = collectBulkClaudePromptEntries(ctx);
  const tk = ctx.ticker.trim();
  const errors: string[] = [];
  if (!tk) return { ok: 0, fail: 0, errors: [] };

  let ok = 0;
  let fail = 0;
  const total = entries.length;

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    onProgress?.({ index: i + 1, total, label: e.label });

    try {
      let lastErr = "";

      for (let attempt = 0; attempt < BULK_API_RATE_LIMIT_MAX_ATTEMPTS; attempt++) {
        const res = await fetch("/api/tab-prompt-complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider,
            userPrompt: e.prompt.trim(),
            maxTokens: LLM_MAX_OUTPUT_TOKENS,
            ...modelPayload,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as { ok?: boolean; text?: string; error?: string };
        if (res.ok && data.ok === true && typeof data.text === "string") {
          const trimmed = data.text.trim();
          const saved = await saveToServer(tk, e.saveKey, trimmed);
          if (!saved) {
            fail++;
            errors.push(`${e.label}: model replied but save to disk failed`);
          } else {
            ok++;
          }
          break;
        }

        lastErr = data.error || `Request failed (${res.status})`;
        const rateLimited = isRateLimitError(res.status, lastErr);
        if (rateLimited && attempt < BULK_API_RATE_LIMIT_MAX_ATTEMPTS - 1) {
          await delay(12_000 + attempt * 10_000);
          continue;
        }
        throw new Error(lastErr);
      }
    } catch (err) {
      fail++;
      errors.push(`${e.label}: ${err instanceof Error ? err.message : String(err)}`);
    }

    if (i < entries.length - 1) {
      await new Promise((r) => setTimeout(r, BULK_API_STAGGER_MS));
    }
  }

  return { ok, fail, errors };
}

