import { buildCompanyHistoryAiPrompt, PROMPT_TEMPLATE as COMPANY_HISTORY_PROMPT_TEMPLATE } from "@/components/CompanyHistoryTab";
import {
  buildBulkCapitalStructurePrompt,
  buildBulkCreditDocsListPrompt,
  buildBulkOrgChartPrompt,
  type BulkOpenContext,
} from "@/lib/bulk-ai-open";
import { companyNav, companyTopSections, type CompanyTopSectionId } from "@/data/company-navigation";
import { AI_RISK_PROMPT_TEMPLATE } from "@/data/ai-risk-prompt";
import { BUSINESS_MODEL_PROMPT_TEMPLATE } from "@/data/business-model-prompt";
import { BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE } from "@/data/business-risk-analysis-prompt";
import { CAPITAL_ALLOCATION_PROMPT_TEMPLATE } from "@/data/capital-allocation-prompt";
import { COMPANY_REPUTATION_PROMPT_TEMPLATE } from "@/data/company-reputation-prompt";
import {
  COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE,
  fillCompetitorEarningsReadThrusPrompt,
} from "@/data/competitor-earnings-readthrus-prompt";
import { COMPETITORS_PROMPT_TEMPLATE } from "@/data/competitors-prompt";
import { CUSTOMERS_PROMPT_TEMPLATE } from "@/data/customers-prompt";
import { EMPLOYEE_CONTACTS_PROMPT_TEMPLATE } from "@/data/employee-contacts-prompt";
import {
  HOW_STUFF_WORKS_PROMPT_TEMPLATE,
  fillHowStuffWorksPromptPlaceholders,
} from "@/data/how-stuff-works-prompt";
import { INDUSTRY_CONTACTS_PROMPT_TEMPLATE } from "@/data/industry-contacts-prompt";
import { INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE } from "@/data/industry-history-drivers-prompt";
import { INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE } from "@/data/industry-publications-prompt";
import {
  INDUSTRY_VALUE_CHAIN_PROMPT_TEMPLATE,
  resolveIndustryValueChainTemplate,
} from "@/data/industry-value-chain-prompt";
import { MANAGEMENT_BOARD_PROMPT_TEMPLATE } from "@/data/management-board-prompt";
import { MGMT_PRESENTATIONS_PROMPT_TEMPLATE } from "@/data/mgmt-presentations-prompt";
import { OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE } from "@/data/out-of-the-box-ideas-prompt";
import { OVERVIEW_PROMPT_TEMPLATE } from "@/data/overview-prompt";
import { PORTERS_FIVE_FORCES_PROMPT_TEMPLATE } from "@/data/porters-five-forces-prompt";
import { RECENT_EVENTS_PROMPT_TEMPLATE } from "@/data/recent-events-prompt";
import { RESEARCH_ROADMAP_PROMPT_TEMPLATE } from "@/data/research-roadmap-prompt";
import { RISK_FROM_10K_PROMPT_TEMPLATE } from "@/data/risk-from-10k-prompt";
import { STARTUP_RISKS_PROMPT_TEMPLATE } from "@/data/startup-risks-prompt";
import { SUBSIDIARY_LIST_PROMPT_TEMPLATE } from "@/data/subsidiary-list-prompt";
import { SUPPLIERS_PROMPT_TEMPLATE } from "@/data/suppliers-prompt";
import { buildCreditTimelineAiPrompt, CREDIT_TIMELINE_PROMPT_TEMPLATE } from "@/components/CompanyCreditTimelineTab";
import {
  DOC_REVIEW_PROMPT,
  getCreditAgreementsDocReviewAiPrompt,
} from "@/lib/credit-agreements-prompts";
import { fillCompanyPromptTemplate, resolveCompanyPromptLabels } from "@/lib/company-prompt-labels";
import { readPromptTemplateOverride } from "@/lib/prompt-template-storage";

const PROMPT_EXPORT_SECTIONS: CompanyTopSectionId[] = [
  "overview",
  "industry-competition",
  "capital-structure",
  "research",
];

export const PROMPT_EXPORT_ACCOUNT_EMAIL = "guowei58@hotmail.com";

export function canExportTickerPrompts(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === PROMPT_EXPORT_ACCOUNT_EMAIL;
}

export type TickerPromptExportEntry = {
  tabLabel: string;
  prompt: string;
};

export type TickerPromptExportSection = {
  sectionId: CompanyTopSectionId;
  sectionLabel: string;
  prompts: TickerPromptExportEntry[];
};

export type TickerPromptExportBundle = {
  ticker: string;
  companyName: string | null;
  generatedAt: string;
  sections: TickerPromptExportSection[];
};

function sectionLabel(sectionId: CompanyTopSectionId): string {
  return companyTopSections.find((s) => s.id === sectionId)?.label ?? sectionId;
}

function creditDocReviewPrompt(documentLabel: string): string {
  const template = readPromptTemplateOverride("credit-agreements-doc-review", DOC_REVIEW_PROMPT);
  const body = getCreditAgreementsDocReviewAiPrompt(template);
  return `Target document: ${documentLabel} (from your Credit Docs List — append the SOURCE DOCUMENT LINK before running.)\n\n${body}`;
}

function resolveTabPrompt(tabLabel: string, ctx: BulkOpenContext): string | null {
  const tk = ctx.ticker.trim();
  if (!tk) return null;

  const labels = resolveCompanyPromptLabels({ workspaceKey: tk, companyName: ctx.companyName });
  const { displayName: dn, tickerForPrompt, parenLabel: labelParen } = labels;
  const fill = (template: string) => fillCompanyPromptTemplate(template, tk, ctx.companyName);
  const ov = readPromptTemplateOverride;

  switch (tabLabel) {
    case "Business Overview":
      return fill(ov("business-overview", OVERVIEW_PROMPT_TEMPLATE));
    case "Recent Events":
      return fill(ov("recent-events", RECENT_EVENTS_PROMPT_TEMPLATE));
    case "Management & Board":
      return fill(ov("management-board", MANAGEMENT_BOARD_PROMPT_TEMPLATE));
    case "Business Model":
      return fill(ov("business-model", BUSINESS_MODEL_PROMPT_TEMPLATE));
    case "HowStuffWorks":
      return fillHowStuffWorksPromptPlaceholders(
        ov("how-stuff-works", HOW_STUFF_WORKS_PROMPT_TEMPLATE),
        dn,
        tickerForPrompt
      );
    case "Company History":
      return buildCompanyHistoryAiPrompt(tk, ctx.companyName, ov("company-history", COMPANY_HISTORY_PROMPT_TEMPLATE));
    case "Capital Allocation":
      return fill(ov("capital-allocation", CAPITAL_ALLOCATION_PROMPT_TEMPLATE));
    case "Credit Timeline":
      return buildCreditTimelineAiPrompt(tk, ov("credit-timeline", CREDIT_TIMELINE_PROMPT_TEMPLATE));
    case "Out-of-the-Box Ideas":
      return fill(ov("out-of-the-box-ideas", OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE));
    case "Risk from 10K":
      return fill(ov("risk-from-10k", RISK_FROM_10K_PROMPT_TEMPLATE));
    case "Business Risk Analysis":
      return fill(ov("business-risk-analysis", BUSINESS_RISK_ANALYSIS_PROMPT_TEMPLATE));
    case "Porter's Five Forces":
      return ov("porters-five-forces", PORTERS_FIVE_FORCES_PROMPT_TEMPLATE).replace(
        /\[COMPANY NAME \/ TICKER\]/g,
        labelParen
      );
    case "Industry History and Drivers":
      return fill(ov("industry-history-drivers", INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE));
    case "Industry Value Chain":
      return resolveIndustryValueChainTemplate(
        ov("industry-value-chain", INDUSTRY_VALUE_CHAIN_PROMPT_TEMPLATE),
        tk,
        ctx.companyName
      );
    case "Competitors":
      return ov("competitors", COMPETITORS_PROMPT_TEMPLATE).replace(/\[INSERT TICKER\]/g, labelParen);
    case "Customers":
      return fill(ov("customers", CUSTOMERS_PROMPT_TEMPLATE));
    case "Suppliers":
      return fill(ov("suppliers", SUPPLIERS_PROMPT_TEMPLATE));
    case "Startup Risks":
      return fill(ov("startup-risks", STARTUP_RISKS_PROMPT_TEMPLATE));
    case "AI Risk":
      return fill(ov("ai-risk", AI_RISK_PROMPT_TEMPLATE));
    case "Capital Structure":
      return buildBulkCapitalStructurePrompt(ctx);
    case "Org Chart":
      return buildBulkOrgChartPrompt(ctx);
    case "Credit Docs List":
      return buildBulkCreditDocsListPrompt(ctx);
    case "Credit Agreement":
      return creditDocReviewPrompt("credit agreement");
    case "First Lien Notes":
      return creditDocReviewPrompt("first lien notes");
    case "2nd Lien Notes":
      return creditDocReviewPrompt("2nd lien notes");
    case "Unsecured Notes":
      return creditDocReviewPrompt("unsecured notes");
    case "Other Credit Documents":
      return creditDocReviewPrompt("other credit documents");
    case "Entity Mapper":
      return fill(ov("subsidiary-list", SUBSIDIARY_LIST_PROMPT_TEMPLATE));
    case "Research Roadmap":
      return fill(ov("research-roadmap", RESEARCH_ROADMAP_PROMPT_TEMPLATE));
    case "Company Reputation":
      return fill(ov("company-reputation", COMPANY_REPUTATION_PROMPT_TEMPLATE));
    case "Competitor Earnings ReadThrus":
      return fillCompetitorEarningsReadThrusPrompt(
        ov("competitor-earnings-readthrus", COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE),
        tk,
        ctx.companyName
      );
    case "Mgmt Presentations & Transcripts":
      return ov("presentations", MGMT_PRESENTATIONS_PROMPT_TEMPLATE)
        .replace(/\{\{TICKER\}\}/g, tickerForPrompt)
        .replace(/\{\{COMPANY_NAME\}\}/g, dn);
    case "Industry Publications":
      return fill(ov("industry-publications", INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE));
    case "Industry Contacts":
      return fill(ov("industry-contacts", INDUSTRY_CONTACTS_PROMPT_TEMPLATE));
    case "Employee Contacts":
      return fill(ov("employee-contacts", EMPLOYEE_CONTACTS_PROMPT_TEMPLATE));
    default:
      return null;
  }
}

export function collectTickerPromptExport(ctx: BulkOpenContext): TickerPromptExportBundle {
  const ticker = ctx.ticker.trim().toUpperCase();
  const sections: TickerPromptExportSection[] = [];

  for (const sectionId of PROMPT_EXPORT_SECTIONS) {
    const nav = companyNav[sectionId];
    const prompts: TickerPromptExportEntry[] = [];
    const seen = new Set<string>();

    for (const group of nav.groups) {
      for (const tabLabel of group.tabs) {
        if (seen.has(tabLabel)) continue;
        const prompt = resolveTabPrompt(tabLabel, ctx);
        if (!prompt?.trim()) continue;
        seen.add(tabLabel);
        prompts.push({ tabLabel, prompt: prompt.trim() });
      }
    }

    if (prompts.length > 0) {
      sections.push({
        sectionId,
        sectionLabel: sectionLabel(sectionId),
        prompts,
      });
    }
  }

  return {
    ticker,
    companyName: ctx.companyName?.trim() || null,
    generatedAt: new Date().toISOString(),
    sections,
  };
}

export function formatTickerPromptExportText(bundle: TickerPromptExportBundle): string {
  const headerName = bundle.companyName
    ? `${bundle.ticker} (${bundle.companyName})`
    : bundle.ticker;

  const lines: string[] = [
    `OREO Prompt Export — ${headerName}`,
    `Generated: ${bundle.generatedAt}`,
    "",
  ];

  let promptNumber = 0;

  for (const section of bundle.sections) {
    lines.push("=".repeat(80));
    lines.push(`SECTION: ${section.sectionLabel}`);
    lines.push("=".repeat(80));
    lines.push("");

    for (const entry of section.prompts) {
      promptNumber += 1;
      lines.push(`Prompt #${promptNumber}: ${entry.tabLabel}`);
      lines.push("-".repeat(80));
      lines.push(entry.prompt);
      lines.push("");
    }
  }

  if (promptNumber === 0) {
    lines.push("No prompts found for this ticker.");
  }

  return lines.join("\n");
}
