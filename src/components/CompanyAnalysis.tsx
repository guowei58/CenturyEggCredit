"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { tabLabelToId } from "@/lib/tabs";
import type { CompanyTopSectionId } from "@/data/company-navigation";
import { companyNav, companyTopSections } from "@/data/company-navigation";
import {
  formatWorkspaceBadge,
  isCikWorkspaceKey,
  isPrivateWorkspaceKey,
  privateWorkspaceDisplayName,
} from "@/lib/company-workspace-key";
import {
  MOCK_TICKER,
  PLACEHOLDER_COMPANY_DISPLAY_NAME,
  PLACEHOLDER_DEFAULT_TICKER,
  mockCompanyBar,
} from "@/data/mock";
import { CompanyBar } from "@/components/layout";
import { CompanyFilingsTab } from "@/components/CompanyFilingsTab";
import { CompanyFccFilingsTab } from "@/components/CompanyFccFilingsTab";
import { CompanyOrgChartTab } from "@/components/CompanyOrgChartTab";
import { CompanyCapitalStructureTab } from "@/components/CompanyCapitalStructureTab";
import { CompanyEntityMapperTab } from "@/components/CompanyEntityMapperTab";
import { CompanyOverviewTab } from "@/components/CompanyOverviewTab";
import { CompanyRecentEventsTab } from "@/components/CompanyRecentEventsTab";
import { CompanyHowStuffWorksTab } from "@/components/CompanyHowStuffWorksTab";
import { CompanyRiskFrom10kTab } from "@/components/CompanyRiskFrom10kTab";
import { CompanyBusinessRiskAnalysisTab } from "@/components/CompanyBusinessRiskAnalysisTab";
import { CompanyManagementBoardTab } from "@/components/CompanyManagementBoardTab";
import { CompanyOutOfTheBoxIdeasTab } from "@/components/CompanyOutOfTheBoxIdeasTab";
import { CompanyResearchRoadmapTab } from "@/components/CompanyResearchRoadmapTab";
import { CompanyPresentationsTab } from "@/components/CompanyPresentationsTab";
import { BusinessModelTab } from "@/components/BusinessModelTab";
import { CompanyHistoryTab } from "@/components/CompanyHistoryTab";
import { CompanyCapitalAllocationTab } from "@/components/CompanyCapitalAllocationTab";
import { CompanyPortersFiveForcesTab } from "@/components/CompanyPortersFiveForcesTab";
import { CompanyIndustryHistoryDriversTab } from "@/components/CompanyIndustryHistoryDriversTab";
import { CompanyIndustryValueChainTab } from "@/components/CompanyIndustryValueChainTab";
import { CompanyEnvironmentalClaimsTab } from "@/components/CompanyEnvironmentalClaimsTab";
import { CompanyCompetitorsTab } from "@/components/CompanyCompetitorsTab";
import { CompanyCustomersTab } from "@/components/CompanyCustomersTab";
import { CompanySuppliersTab } from "@/components/CompanySuppliersTab";
import { CompanyStartupRisksTab } from "@/components/CompanyStartupRisksTab";
import { CompanySavedDocumentsTab } from "@/components/CompanySavedDocumentsTab";
import { PublicRecordsTab } from "@/components/PublicRecordsTab";
import { CompanyTrademarkIpTab } from "@/components/CompanyTrademarkIpTab";
import { CompanyNewsEventsTab } from "@/components/CompanyNewsEventsTab";
import { CompanyIndustryPublicationsTab } from "@/components/CompanyIndustryPublicationsTab";
import { CompanyOtherRegulatoryFilingsTab } from "@/components/company/CompanyOtherRegulatoryFilingsTab";
import { CompanyRegulatoryApiTab } from "@/components/company/CompanyRegulatoryApiTab";
import { CompanySubsidiaryListTab } from "@/components/CompanySubsidiaryListTab";
import { CompanyLmeAnalysisTab } from "@/components/CompanyLmeAnalysisTab";
import {
  CompanyCreditDocWorkspaceTab,
  CREDIT_DOC_TAB_ID_TO_VARIANT,
} from "@/components/CompanyCreditAgreementsIndenturesTab";
import { CompanyAiCreditMemoTab } from "@/components/CompanyAiCreditMemoTab";
import { CompanyCapStructureRecommendationTab } from "@/components/CompanyCapStructureRecommendationTab";
import { CompanyLiteraryReferencesTab } from "@/components/CompanyLiteraryReferencesTab";
import { CompanyBiblicalReferencesTab } from "@/components/CompanyBiblicalReferencesTab";
import { CompanyHowToLookLikeADumbassTab } from "@/components/CompanyHowToLookLikeADumbassTab";
import { CompanyNextQuarterEarningsTranscriptTab } from "@/components/CompanyNextQuarterEarningsTranscriptTab";
import { CompanyForensicAnalysisTab } from "@/components/CompanyForensicAnalysisTab";
import { CompanyCreditTimelineTab } from "@/components/CompanyCreditTimelineTab";
import { CompanySubstackTab } from "@/components/CompanySubstackTab";
import { CompanyReputationTab } from "@/components/CompanyReputationTab";
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
import { CompanySecFilingFinancialsTab } from "@/components/CompanySecFilingFinancialsTab";
import { CompanySecXbrlFinancialsTab } from "@/components/CompanySecXbrlFinancialsTab";
import { CompanyTestFinancialsTab } from "@/components/CompanyTestFinancialsTab";
import { CompanyRoicAiTab } from "@/components/CompanyRoicAiTab";
import {
  CompanyRoicAiV2StatementsTab,
  ROIC_ANNUAL_FINANCIAL_STATEMENTS_TAB_ID,
  ROIC_QUARTERLY_FINANCIAL_STATEMENTS_TAB_ID,
} from "@/components/CompanyRoicAiV2StatementsTab";
import { DownloadAllUserDataButton } from "@/components/DownloadAllUserDataButton";
import { Card, EmptyState, TabBar } from "@/components/ui";

/** Build company bar data: full mock for LUMN, else ticker/CIK + fetched name. */
function getCompanyBarData(ticker: string, companyName: string | null) {
  if (ticker === MOCK_TICKER) return mockCompanyBar;
  if (ticker === PLACEHOLDER_DEFAULT_TICKER) {
    return { ticker: PLACEHOLDER_DEFAULT_TICKER, name: PLACEHOLDER_COMPANY_DISPLAY_NAME };
  }
  if (isPrivateWorkspaceKey(ticker)) {
    return {
      ticker,
      name: privateWorkspaceDisplayName(ticker, companyName),
    };
  }
  const badge = formatWorkspaceBadge(ticker);
  const resolvedName =
    companyName && companyName.toUpperCase() !== ticker && companyName.toUpperCase() !== badge
      ? companyName
      : isCikWorkspaceKey(ticker)
        ? "SEC filer"
        : ticker;
  return {
    ticker,
    name: resolvedName,
  };
}

export function CompanyAnalysis({
  ticker,
  activeTab,
  onTabChange,
  onTickerSelect,
  topSection,
  onTopSectionChange,
  aiChatOpen = false,
  onOpenAiChat,
}: {
  ticker: string | null;
  activeTab: string;
  onTabChange: (tab: string) => void;
  onTickerSelect?: (ticker: string) => void;
  topSection: CompanyTopSectionId;
  onTopSectionChange: (s: CompanyTopSectionId) => void;
  /** When true, suppress the per-ticker AI Chat unread dot (drawer is open). */
  aiChatOpen?: boolean;
  onOpenAiChat?: () => void;
}) {
  const [companyName, setCompanyName] = useState<string | null>(null);

  /** Avoid one frame (or parallel request) with the previous ticker’s display name — it seeds `PublicRecordsProfile.companyName` on first GET. */
  useLayoutEffect(() => {
    setCompanyName(null);
  }, [ticker]);

  useEffect(() => {
    if (!ticker || ticker === MOCK_TICKER || ticker === PLACEHOLDER_DEFAULT_TICKER) {
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

  useEffect(() => {
    if (activeTab === "credit-decision-dashboard") {
      onTopSectionChange("work-product");
      onTabChange("recommendation");
    }
  }, [activeTab, onTabChange, onTopSectionChange]);

  const co = ticker ? getCompanyBarData(ticker, companyName) : null;
  /** EdgarTools tab removed from nav; map stale id to SEC Filings without a one-frame flash. */
  const resolvedTab =
    activeTab === "edgartools-sec"
      ? "sec-filings"
      : activeTab === "test"
        ? "period-financials"
        : activeTab === "20-year-look-back" ||
            activeTab === "sec-xbrl-financials" ||
            activeTab === "sec-filing-financials"
          ? "historical-financial-statements"
        : activeTab === "earnings-releases"
          ? "research-roadmap"
        : activeTab === tabLabelToId("Other Regulatory Filings - Manual")
          ? "other-regulatory-filings"
        : activeTab === tabLabelToId("NHTSA") || activeTab === tabLabelToId("NHTSA Filings")
          ? "other-regulatory-filings"
        : activeTab === tabLabelToId("FDIC BankFind")
          ? "other-regulatory-filings"
        : activeTab === tabLabelToId("OCC Institution Data")
          ? "other-regulatory-filings"
        : activeTab;

  const effectiveTopSection = topSection === ("credit-decision-dashboard" as never) ? "work-product" : topSection;
  const navDef = companyNav[effectiveTopSection];
  const groups = navDef?.groups ?? [];
  const savedDocsActive = resolvedTab === "saved-documents";

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {co && (
        <CompanyBar
          data={co}
          companyNameForPrompts={companyName}
          aiChatOpen={aiChatOpen}
          onOpenAiChat={onOpenAiChat}
        />
      )}
      {co ? (
        <>
          {/* Level 1: section tabs directly under ticker/name (primary style) */}
          <nav
            className="nav-section-row flex w-full min-w-0 flex-shrink-0 items-center gap-3 px-6 sm:px-8"
            aria-label="Sections"
          >
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {companyTopSections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => onTopSectionChange(s.id)}
                  className={`nav-section-tab ${effectiveTopSection === s.id ? "active" : ""}`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  onTopSectionChange("documents");
                  onTabChange("saved-documents");
                }}
                className="btn-shell hi inline-flex shrink-0 items-center gap-2 rounded-md px-4 py-2 text-xs font-semibold shadow-md transition-[box-shadow,opacity] hover:shadow-lg"
                style={{
                  color: savedDocsActive ? "var(--accent-fg)" : "var(--text)",
                  borderColor: savedDocsActive ? "var(--accent)" : "var(--border2)",
                  background: savedDocsActive
                    ? "var(--accent)"
                    : "color-mix(in srgb, var(--card2) 65%, var(--card))",
                  boxShadow: savedDocsActive
                    ? "0 1px 0 color-mix(in srgb, var(--accent) 55%, transparent)"
                    : "0 1px 0 color-mix(in srgb, var(--border2) 60%, transparent)",
                }}
                title="Open Saved Documents for this ticker"
              >
                Saved Documents
              </button>
              <DownloadAllUserDataButton />
            </div>
          </nav>

          {/* Level 2: sub-tabs for the active top-level section only (secondary) */}
          {groups.length > 0 &&
            !savedDocsActive &&
            !(groups.length === 1 && (groups[0]?.tabs?.length ?? 0) <= 1) && (
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

          <div className="min-h-0 flex-1 overflow-hidden">
            {resolvedTab === "sec-xbrl-financials" ? (
              <div className="flex h-full min-h-0 flex-col">
                <CompanySecXbrlFinancialsTab ticker={ticker!} />
              </div>
            ) : resolvedTab === "test" || resolvedTab === "period-financials" ? (
              <div className="flex h-full min-h-0 flex-col">
                <CompanyTestFinancialsTab ticker={ticker!} />
              </div>
            ) : (
              <div className="h-full min-h-0 overflow-y-auto px-5 py-4 sm:px-8 sm:py-5" data-company-tab-workspace>
                <CompanyTabContent tabId={resolvedTab} ticker={ticker!} companyName={co.name} />
              </div>
            )}
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
  if (tabId === "public-records-profile") {
    return <PublicRecordsTab ticker={ticker} companyName={companyName} profileOnly />;
  }
  if (tabId === "business-overview") {
    return <CompanyOverviewTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "recent-events") {
    return <CompanyRecentEventsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "howstuffworks") {
    return <CompanyHowStuffWorksTab ticker={ticker} companyName={companyName} />;
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
  if (tabId === "business-model") {
    return <BusinessModelTab ticker={ticker} companyName={companyName} />;
  }
  if (
    tabId === "historical-financial-statements" ||
    tabId === "financials" ||
    tabId === "the-good-bad-and-ugly-historical-financial-statements" ||
    tabId === "deterministic-xbrl-statement-compiler"
  ) {
    return (
      <CompanyFinancialsTab
        ticker={ticker}
        scrollToBadSection={tabId === "deterministic-xbrl-statement-compiler"}
      />
    );
  }
  if (tabId === "kpi" || tabId === "kpi-commentary") {
    return <CompanyKpiTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "sec-xbrl-financials") {
    return <CompanySecXbrlFinancialsTab ticker={ticker} />;
  }
  if (tabId === "test" || tabId === "period-financials") {
    return <CompanyTestFinancialsTab ticker={ticker} />;
  }
  if (tabId === "sec-filing-financials") {
    return <CompanySecFilingFinancialsTab ticker={ticker} />;
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
  if (tabId === tabLabelToId("Entity Mapper")) {
    return <CompanyEntityMapperTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "org-chart") {
    return <CompanyOrgChartTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "sec-filings") {
    return <CompanyFilingsTab ticker={ticker} />;
  }
  if (tabId === tabLabelToId("Litigation")) {
    return (
      <CompanyRegulatoryApiTab
        ticker={ticker ?? ""}
        companyName={companyName}
        sourceId="litigation"
        tabTitle="Litigation"
      />
    );
  }
  if (tabId === tabLabelToId("Enforcements")) {
    return (
      <CompanyRegulatoryApiTab
        ticker={ticker ?? ""}
        companyName={companyName}
        sourceId="enforcements"
        tabTitle="Enforcements"
      />
    );
  }
  if (tabId === "fcc-filings") {
    return <CompanyFccFilingsTab ticker={ticker ?? ""} />;
  }
  if (tabId === "other-regulatory-filings") {
    return <CompanyOtherRegulatoryFilingsTab ticker={ticker ?? ""} companyName={companyName} />;
  }
  // Regulatory APIs (split out of "Other Regulatory Filings")
  if (tabId === tabLabelToId("EPA ECHO Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="epa_echo" tabTitle="EPA ECHO Filings" />;
  }
  if (tabId === tabLabelToId("EPA Envirofacts Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="epa_envirofacts" tabTitle="EPA Envirofacts Filings" />;
  }
  if (tabId === tabLabelToId("FDA / openFDA Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="fda_openfda" tabTitle="FDA / openFDA Filings" />;
  }
  if (tabId === tabLabelToId("CFPB Complaints")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="cfpb_complaints" tabTitle="CFPB Complaints" />;
  }
  if (tabId === tabLabelToId("FFIEC CDR")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="ffiec_cdr" tabTitle="FFIEC CDR" />;
  }
  if (tabId === tabLabelToId("CMS Data")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="cms_data" tabTitle="CMS Data" />;
  }
  if (tabId === tabLabelToId("OSHA")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="osha" tabTitle="OSHA" />;
  }
  if (tabId === tabLabelToId("OFAC Sanctions")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="ofac" tabTitle="OFAC Sanctions" />;
  }
  if (tabId === tabLabelToId("PHMSA")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="phmsa" tabTitle="PHMSA" />;
  }
  if (tabId === tabLabelToId("FERC")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="ferc" tabTitle="FERC" />;
  }
  if (tabId === tabLabelToId("USAspending Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="usaspending" tabTitle="USAspending Filings" />;
  }
  if (tabId === tabLabelToId("Federal Register Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="federal_register" tabTitle="Federal Register Filings" />;
  }
  if (tabId === tabLabelToId("Regulations.gov Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="regulations_gov" tabTitle="Regulations.gov Filings" />;
  }
  if (tabId === tabLabelToId("eCFR Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="ecfr" tabTitle="eCFR Filings" />;
  }
  if (tabId === tabLabelToId("EIA Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="eia" tabTitle="EIA Filings" />;
  }
  if (tabId === tabLabelToId("SAM.gov Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="sam_gov" tabTitle="SAM.gov Filings" />;
  }
  if (tabId === tabLabelToId("FEC Filings")) {
    return <CompanyRegulatoryApiTab ticker={ticker ?? ""} companyName={companyName} sourceId="fec" tabTitle="FEC Filings" />;
  }
  if (tabId === "saved-documents") {
    return <CompanySavedDocumentsTab ticker={ticker} />;
  }
  if (tabId === "patent-ip-filings") {
    return <CompanyTrademarkIpTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "state-local-public-records") {
    return <PublicRecordsTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "subsidiary-list") {
    return <CompanySubsidiaryListTab ticker={ticker ?? ""} />;
  }
  if (tabId in CREDIT_DOC_TAB_ID_TO_VARIANT) {
    return (
      <CompanyCreditDocWorkspaceTab
        ticker={ticker ?? ""}
        variant={CREDIT_DOC_TAB_ID_TO_VARIANT[tabId]!}
      />
    );
  }
  if (tabId === "lme-analysis") {
    return <CompanyLmeAnalysisTab ticker={ticker ?? ""} />;
  }
  if (tabId === "ratings-research-links") {
    const sym = ticker?.trim().toUpperCase() ?? "";
    return (
      <Card title={sym ? `Ratings Research Links — ${sym}` : "Ratings Research Links"}>
        <RatingsResearchLinks ticker={ticker} companyName={companyName} />
      </Card>
    );
  }
  if (tabId === "broker-activities" || tabId === "broker-research-reports") {
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
  if (tabId === "company-reputation") {
    return <CompanyReputationTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "the-cap-stack-rumor-mill") {
    return <CompanyCapStackRumorMillTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "mgmt-presentations-transcripts") {
    return <CompanyPresentationsTab ticker={ticker ?? ""} companyName={companyName} />;
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
  if (tabId === "industry-history-and-drivers") {
    return <CompanyIndustryHistoryDriversTab ticker={ticker} companyName={companyName} />;
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
  if (tabId === "business-risk-analysis") {
    return <CompanyBusinessRiskAnalysisTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "credit-timeline") {
    return <CompanyCreditTimelineTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "recommendation") {
    return <CompanyCapStructureRecommendationTab ticker={ticker} />;
  }
  if (tabId === "literary-references") {
    return <CompanyLiteraryReferencesTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "biblical-references") {
    return <CompanyBiblicalReferencesTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "how-to-look-like-a-dumbass") {
    return <CompanyHowToLookLikeADumbassTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "next-quarter-earnings-transcript") {
    return <CompanyNextQuarterEarningsTranscriptTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "ai-memo-and-deck" || tabId === "ai-credit-memo") {
    return <CompanyAiCreditMemoTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "entity-searches") {
    return <CompanyEntitySearchesTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "forensic-analysis") {
    return <CompanyForensicAnalysisTab ticker={ticker} companyName={companyName} />;
  }
  if (tabId === "environmental-claims") {
    return <CompanyEnvironmentalClaimsTab ticker={ticker ?? ""} companyName={companyName} />;
  }
  /** Risk → Claims / Fraud checks & diligence: not finished; show explicit copy instead of generic placeholder. */
  const riskIncompleteTabIds = new Set([
    "litigation-claims",
    "laborpension-claims",
    "tax-claims",
    "regulatory-claims",
    "lease-claims",
    "tradesupply-chain-claims",
    "liens",
    "management-background-check",
    "legal-searches",
    "related-party-checks",
  ]);

  const newTabPlaceholders: Record<string, string> = {
    "other-regulatory-filings": "Other Regulatory Filings - Manual",
    [tabLabelToId("Other Regulatory Filings - Manual")]: "Other Regulatory Filings - Manual",
    substack: "Substack",
    "company-reputation": "Company Reputation",
    "twitter-sentiment": "Twitter Sentiment",
    "dear-diary": "Dear Diary",
    "ai-memo-and-deck": "AI Memo and Deck",
    "broker-activities": "Broker Activities",
    "broker-research-reports": "Broker Activities",
    "the-cap-stack-rumor-mill": "The Cap Stack Rumor Mill",
    "startup-risks": "Startup Risks",
    "competitor-operating-metrics": "Competitor Operating Metrics",
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
    "credit-docs-list": "Credit Docs List",
    "subsidiary-list": "Subsidiary List",
  };
  if (newTabPlaceholders[tabId]) {
    const phTitle = newTabPlaceholders[tabId];
    const incomplete = riskIncompleteTabIds.has(tabId);
    return (
      <Card title={`${phTitle} — ${ticker}`}>
        <p className="text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
          {incomplete ? "To come…" : "Placeholder — no content yet."}
        </p>
        {incomplete ? (
          <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--muted)" }}>
            This section is not complete yet.
          </p>
        ) : null}
      </Card>
    );
  }
  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--muted2)" }}>Tab: {tabId}</p>
    </Card>
  );
}

