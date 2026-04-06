"use client";

import { useEffect, useState } from "react";
import { tabLabelToId } from "@/lib/tabs";
import type { CompanyTopSectionId } from "@/data/company-navigation";
import { companyNav, companyTopSections } from "@/data/company-navigation";
import {
  MOCK_TICKER,
  mockCompanyBar,
  mockCapitalStructure,
  mockFinancialsChartYears,
  mockWorkingCapital,
} from "@/data/mock";
import { CompanyBar } from "@/components/layout";
import { CompanyFilingsTab } from "@/components/CompanyFilingsTab";
import { CompanyFccFilingsTab } from "@/components/CompanyFccFilingsTab";
import { CompanyOrgChartTab } from "@/components/CompanyOrgChartTab";
import { CompanyCapitalStructureTab } from "@/components/CompanyCapitalStructureTab";
import { CompanyOverviewTab } from "@/components/CompanyOverviewTab";
import { CompanyRiskFrom10kTab } from "@/components/CompanyRiskFrom10kTab";
import { CompanyManagementBoardTab } from "@/components/CompanyManagementBoardTab";
import { CompanyOutOfTheBoxIdeasTab } from "@/components/CompanyOutOfTheBoxIdeasTab";
import { CompanyResearchRoadmapTab } from "@/components/CompanyResearchRoadmapTab";
import { CompanyIrPageIndexerTab } from "@/components/CompanyIrPageIndexerTab";
import { CompanyPresentationsTab } from "@/components/CompanyPresentationsTab";
import { CompanyEarningsReleasesTab } from "@/components/CompanyEarningsReleasesTab";
import { BusinessModelTab } from "@/components/BusinessModelTab";
import { CompanyHistoryTab } from "@/components/CompanyHistoryTab";
import { CompanyCapitalAllocationTab } from "@/components/CompanyCapitalAllocationTab";
import { CompanyPortersFiveForcesTab } from "@/components/CompanyPortersFiveForcesTab";
import { CompanyIndustryValueChainTab } from "@/components/CompanyIndustryValueChainTab";
import { CompanyEnvironmentalClaimsTab } from "@/components/CompanyEnvironmentalClaimsTab";
import { CompanyCompetitorsTab } from "@/components/CompanyCompetitorsTab";
import { CompanyCustomersTab } from "@/components/CompanyCustomersTab";
import { CompanySuppliersTab } from "@/components/CompanySuppliersTab";
import { CompanyStartupRisksTab } from "@/components/CompanyStartupRisksTab";
import { CompanySavedDocumentsTab } from "@/components/CompanySavedDocumentsTab";
import { CompanyTrademarkIpTab } from "@/components/CompanyTrademarkIpTab";
import { CompanyNewsEventsTab } from "@/components/CompanyNewsEventsTab";
import { CompanyIndustryPublicationsTab } from "@/components/CompanyIndustryPublicationsTab";
import { CompanySubsidiaryListTab } from "@/components/CompanySubsidiaryListTab";
import { CompanyLmeAnalysisTab } from "@/components/CompanyLmeAnalysisTab";
import { CompanyCreditAgreementsIndenturesTab } from "@/components/CompanyCreditAgreementsIndenturesTab";
import { CompanyAiCreditMemoTab } from "@/components/CompanyAiCreditMemoTab";
import { CompanyCapStructureRecommendationTab } from "@/components/CompanyCapStructureRecommendationTab";
import { CompanyForensicAccountingTab } from "@/components/CompanyForensicAccountingTab";
import { CompanyCreditTimelineTab } from "@/components/CompanyCreditTimelineTab";
import { CompanySubstackTab } from "@/components/CompanySubstackTab";
import { CompanyRedditTab } from "@/components/CompanyRedditTab";
import { CompanyEntitySearchesTab } from "@/components/CompanyEntitySearchesTab";
import { CompanyCapStackRumorMillTab } from "@/components/CompanyCapStackRumorMillTab";
import { RatingsResearchLinks } from "@/components/company/RatingsResearchLinks";
import { CompanyBrokerResearchTab } from "@/components/CompanyBrokerResearchTab";
import { CompanyTwitterSentimentTab } from "@/components/CompanyTwitterSentimentTab";
import { CompanyEmployeeContactsTab } from "@/components/CompanyEmployeeContactsTab";
import { CompanyIndustryContactsTab } from "@/components/CompanyIndustryContactsTab";
import { CompanyDearDiaryTab } from "@/components/CompanyDearDiaryTab";
import { CompanyFinancialsTab } from "@/components/CompanyFinancialsTab";
import { CompanyKpiTab } from "@/components/CompanyKpiTab";
import { CompanySecXbrlFinancialsTab } from "@/components/CompanySecXbrlFinancialsTab";
import { CompanyRoicAiTab } from "@/components/CompanyRoicAiTab";
import {
  CompanyRoicAiV2StatementsTab,
  ROIC_ANNUAL_FINANCIAL_STATEMENTS_TAB_ID,
  ROIC_QUARTERLY_FINANCIAL_STATEMENTS_TAB_ID,
} from "@/components/CompanyRoicAiV2StatementsTab";
import { Card, DataTable, EmptyState, MetricTile, TabBar } from "@/components/ui";

/** Build company bar data: full mock for LUMN, else ticker + fetched name. */
function getCompanyBarData(ticker: string, companyName: string | null) {
  if (ticker === MOCK_TICKER) return mockCompanyBar;
  return {
    ticker,
    name: companyName && companyName.toUpperCase() !== ticker ? companyName : ticker,
  };
}

export function CompanyAnalysis({
  ticker,
  activeTab,
  onTabChange,
  onTickerSelect,
  topSection,
  onTopSectionChange,
}: {
  ticker: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onTickerSelect?: (ticker: string) => void;
  topSection: CompanyTopSectionId;
  onTopSectionChange: (s: CompanyTopSectionId) => void;
}) {
  const [companyName, setCompanyName] = useState<string | null>(null);

  useEffect(() => {
    if (!ticker || ticker === MOCK_TICKER) {
      setCompanyName(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/company/${encodeURIComponent(ticker)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { name?: string } | null) => {
        if (!cancelled && body && typeof body.name === "string") setCompanyName(body.name.trim());
        else if (!cancelled) setCompanyName(null);
      })
      .catch(() => {
        if (!cancelled) setCompanyName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker]);

  useEffect(() => {
    if (activeTab === "edgartools-sec") {
      onTabChange("sec-filings");
    }
  }, [activeTab, onTabChange]);

  const co = ticker ? getCompanyBarData(ticker, companyName) : null;
  /** EdgarTools tab removed from nav; map stale id to SEC Filings without a one-frame flash. */
  const resolvedTab = activeTab === "edgartools-sec" ? "sec-filings" : activeTab;

  const navDef = companyNav[topSection];
  const groups = navDef?.groups ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {co && <CompanyBar data={co} companyNameForPrompts={companyName} />}
      {co ? (
        <>
          {/* Level 1: section tabs directly under ticker/name (primary style) */}
          <nav
            className="nav-section-row flex flex-shrink-0 items-center gap-1 px-6 sm:px-8"
            aria-label="Sections"
          >
            {companyTopSections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onTopSectionChange(s.id)}
                className={`nav-section-tab ${topSection === s.id ? "active" : ""}`}
              >
                {s.label}
              </button>
            ))}
          </nav>

          {/* Level 2: sub-tabs for the active top-level section only (secondary) */}
          {groups.length > 0 && (
            <div className="nav-secondary flex flex-shrink-0 w-full flex-col">
              {groups.map((group, gi) => {
                const tabs = (group.tabs ?? []).map((label) => ({ id: tabLabelToId(label), label }));
                return (
                  <div
                    key={group.label ?? gi}
                    className="border-b border-[var(--border)] pt-2 pb-1 last:border-b-0"
                    style={{ background: "var(--panel)" }}
                  >
                    {group.label && (
                      <div className="px-6 pb-1 text-[9px] font-semibold uppercase tracking-wider sm:px-8" style={{ color: "var(--muted)" }}>
                        {group.label}
                      </div>
                    )}
                    <TabBar
                      tabs={tabs}
                      activeId={resolvedTab}
                      onSelect={(id) => onTabChange(id)}
                      variant="company"
                    />
                  </div>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-8 sm:py-5">
            <CompanyTabContent tabId={resolvedTab} ticker={ticker!} companyName={co.name} />
          </div>
        </>
      ) : (
        <EmptyState
          icon="馃敩"
          title="Company Analysis"
          description="Search a ticker in the sidebar or click a quick-load name. Corporate credit research shell 鈥?no real data connected."
          actions={
            <>
              {["LUMN", "CCL", "BA"].map((tk) => (
                <button
                  key={tk}
                  type="button"
                  onClick={() => onTickerSelect?.(tk)}
                  className="rounded-md border px-3 py-2 font-mono text-xs transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                  style={{ background: "var(--card)", borderColor: "var(--border)", color: "var(--muted2)" }}
                >
                  {tk}
                </button>
              ))}
            </>
          }
        />
      )}
    </div>
  );
}

function CompanyTabContent({ tabId, ticker, companyName }: { tabId: string; ticker: string; companyName?: string }) {
  if (tabId === "business-overview") {
    return <CompanyOverviewTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "management-board") {
    return <CompanyManagementBoardTab ticker={ticker} />;
  }
  if (tabId === "out-of-the-box-ideas") {
    return <CompanyOutOfTheBoxIdeasTab ticker={ticker} />;
  }
  if (tabId === "research-roadmap") {
    return <CompanyResearchRoadmapTab ticker={ticker} />;
  }
  if (tabId === "ir-page-indexer") {
    return <CompanyIrPageIndexerTab ticker={ticker} />;
  }
  if (tabId === "business-model") {
    return <BusinessModelTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "working-capital") {
    const fmt = (v: number) => (Math.abs(v) >= 1000 ? `${v < 0 ? "-" : ""}$${Math.abs(v) / 1000}B` : `${v < 0 ? "-" : ""}$${Math.abs(v)}M`);
    const fmtDays = (v: number) => `${v < 0 ? "-" : ""}${Math.abs(v)} days`;
    const wcBalances = mockWorkingCapital.filter((r) => r.kind === "dollars");
    const wcDays = mockWorkingCapital.filter((r) => r.kind === "days");
    return (
      <div className="space-y-6">
        <Card title="Working capital balances ($M)">
          <DataTable>
            <thead>
              <tr>
                <th></th>
                {mockFinancialsChartYears.map((y) => (
                  <th key={y} className="text-right">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wcBalances.map((row) => (
                <tr key={row.line}>
                  <td style={{ color: "var(--muted2)" }}>{row.line}</td>
                  <td className="text-right font-mono">{fmt(row.fy2021)}</td>
                  <td className="text-right font-mono">{fmt(row.fy2022)}</td>
                  <td className="text-right font-mono">{fmt(row.fy2023)}</td>
                  <td className="text-right font-mono" style={{ color: row.line === "Net working capital" ? "var(--warn)" : undefined }}>
                    {fmt(row.ltm)}
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
        <Card title="Working capital efficiency (days)">
          <DataTable>
            <thead>
              <tr>
                <th></th>
                {mockFinancialsChartYears.map((y) => (
                  <th key={y} className="text-right">
                    {y}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {wcDays.map((row) => (
                <tr key={row.line}>
                  <td style={{ color: "var(--muted2)" }}>{row.line}</td>
                  <td className="text-right font-mono">{fmtDays(row.fy2021)}</td>
                  <td className="text-right font-mono">{fmtDays(row.fy2022)}</td>
                  <td className="text-right font-mono">{fmtDays(row.fy2023)}</td>
                  <td className="text-right font-mono">{fmtDays(row.ltm)}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
        <p className="text-[10px] leading-relaxed" style={{ color: "var(--muted)" }}>
          Mock data for credit workflow. Wire to filings, internal model, or comps when ready.
        </p>
      </div>
    );
  }
  if (tabId === "historical-financial-statements" || tabId === "financials") {
    return <CompanyFinancialsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "kpi") {
    return <CompanyKpiTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "sec-xbrl-financials") {
    return <CompanySecXbrlFinancialsTab ticker={ticker} />;
  }
  if (tabId === ROIC_ANNUAL_FINANCIAL_STATEMENTS_TAB_ID) {
    return <CompanyRoicAiV2StatementsTab ticker={ticker} statementPeriod="annual" title="Annual Financial Statements" />;
  }
  if (tabId === ROIC_QUARTERLY_FINANCIAL_STATEMENTS_TAB_ID) {
    return (
      <CompanyRoicAiV2StatementsTab ticker={ticker} statementPeriod="quarterly" title="Quarterly Financial Statements" />
    );
  }
  if (tabId === "earnings-call-transcripts") {
    return <CompanyRoicAiTab ticker={ticker} variant="transcript" />;
  }
  if (tabId === "capital-structure") {
    return (
      <CompanyCapitalStructureTab ticker={ticker ?? ""} companyName={companyName} />
    );
  }
  if (tabId === "org-chart") {
    return <CompanyOrgChartTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "sec-filings") {
    return <CompanyFilingsTab ticker={ticker} />;
  }
  if (tabId === "fcc-filings") {
    return <CompanyFccFilingsTab ticker={ticker ?? ""} />;
  }
  if (tabId === "saved-documents") {
    return <CompanySavedDocumentsTab ticker={ticker} />;
  }
  if (tabId === "trademark-ip-filings") {
    return <CompanyTrademarkIpTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "subsidiary-list") {
    return <CompanySubsidiaryListTab ticker={ticker ?? ""} />;
  }
  if (tabId === "credit-agreements-indentures") {
    return <CompanyCreditAgreementsIndenturesTab ticker={ticker ?? ""} />;
  }
  if (tabId === "lme-analysis") {
    return <CompanyLmeAnalysisTab ticker={ticker ?? ""} />;
  }
  if (tabId === "ratings-research-links") {
    return <RatingsResearchLinks ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "broker-research-reports") {
    return <CompanyBrokerResearchTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "news-events") {
    return <CompanyNewsEventsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "industry-publications") {
    return <CompanyIndustryPublicationsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "twitter-sentiment") {
    return <CompanyTwitterSentimentTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "dear-diary") {
    return <CompanyDearDiaryTab ticker={ticker} />;
  }
  if (tabId === "industry-contacts") {
    return <CompanyIndustryContactsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "employee-contacts") {
    return <CompanyEmployeeContactsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "substack") {
    return <CompanySubstackTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "reddit") {
    return <CompanyRedditTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "the-cap-stack-rumor-mill") {
    return <CompanyCapStackRumorMillTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "mgmt-presentations-transcripts") {
    return <CompanyPresentationsTab ticker={ticker ?? ""} companyName={companyName} />;
  }
  if (tabId === "earnings-releases") {
    return <CompanyEarningsReleasesTab ticker={ticker ?? ""} companyName={companyName} />;
  }
  if (tabId === "comps") {
    return (
      <Card title="Comps (Mock)">
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          Peer comparison tables, trading comps, and valuation metrics. Placeholder 鈥?no real data.
        </p>
      </Card>
    );
  }
  if (tabId === "company-history") {
    return <CompanyHistoryTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "capital-allocation") {
    return <CompanyCapitalAllocationTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "porters-five-forces") {
    return <CompanyPortersFiveForcesTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "industry-value-chain") {
    return <CompanyIndustryValueChainTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "competitors") {
    return <CompanyCompetitorsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "customers") {
    return <CompanyCustomersTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "suppliers") {
    return <CompanySuppliersTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "startup-risks") {
    return <CompanyStartupRisksTab ticker={ticker} />;
  }
  if (tabId === "risk-from-10k") {
    return <CompanyRiskFrom10kTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "credit-timeline") {
    return <CompanyCreditTimelineTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "recommendation") {
    return <CompanyCapStructureRecommendationTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "ai-memo-and-deck" || tabId === "ai-credit-memo") {
    return <CompanyAiCreditMemoTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "entity-searches") {
    return <CompanyEntitySearchesTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "forensic-accounting") {
    return <CompanyForensicAccountingTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "environmental-claims") {
    return <CompanyEnvironmentalClaimsTab ticker={ticker ?? ""} companyName={companyName} />;
  }
  const newTabPlaceholders: Record<string, string> = {
    "recovery-analysis": "Recovery Analysis",
    "liquidity-analysis": "Liquidity Analysis",
    "other-regulatory-filings": "Other Regulatory Filings",
    substack: "Substack",
    "twitter-sentiment": "Twitter Sentiment",
    "dear-diary": "Dear Diary",
    "pre-mortem-analysis": "Pre-Mortem Analysis",
    "ai-memo-and-deck": "AI Memo and Deck",
    "broker-research-reports": "Broker Research Reports",
    "the-cap-stack-rumor-mill": "The Cap Stack Rumor Mill",
    "startup-risks": "Startup Risks",
    "competitor-operating-metrics": "Competitor Operating Metrics",
    "literary-references": "Literary References",
    "biblical-references": "Biblical References",
    jokes: "Jokes",
    "litigation-claims": "Litigation Claims",
    "laborpension-claims": "Labor/Pension Claims",
    "tax-claims": "Tax Claims",
    "regulatory-claims": "Regulatory Claims",
    "lease-claims": "Lease Claims",
    "tradesupply-chain-claims": "Trade/Supply Chain Claims",
    liens: "Liens",
    "management-background-check": "Management Background Check",
    "legal-searches": "Legal Searches",
    "related-party-checks": "Related Party Checks",
    "credit-agreements-indentures": "Credit Agreements & Indentures",
    "subsidiary-list": "Subsidiary List",
  };
  if (newTabPlaceholders[tabId]) {
    return (
      <Card title={`${newTabPlaceholders[tabId]} 鈥?${ticker}`}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          Placeholder 鈥?no content yet.
        </p>
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--muted2)" }}>Tab: {tabId}</p>
    </Card>
  );
}

