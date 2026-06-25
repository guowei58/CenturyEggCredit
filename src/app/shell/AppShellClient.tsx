"use client";

import { useSession } from "next-auth/react";
import { useState, useEffect, useCallback, useRef } from "react";
import { initTickerSaveFolder } from "@/lib/saved-data-client";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import { PLACEHOLDER_DEFAULT_TICKER } from "@/data/mock";
import { TopNav, LeftSidebar, ChatDrawer, EggHocCommitteeDrawer } from "@/components/layout";
import { DailyNewsDrawer } from "@/components/daily-news/DailyNewsDrawer";
import { unlockEggHocNotificationAudio } from "@/lib/sounds/playEggHocBark";
import { CompanyAnalysis } from "@/components/CompanyAnalysis";
import { PMDashboard } from "@/components/PMDashboard";
import { Card } from "@/components/ui";
import type { CompanyTopSectionId } from "@/data/company-navigation";
import { getFirstTabIdForTopSection } from "@/data/company-navigation";
import { canAccessRiskChecklist } from "@/lib/risk-checklist/access";
import { getPMDashboardTabId } from "@/lib/tabs";

async function fetchWatchlistForShell(): Promise<string[] | null> {
  try {
    const res = await fetch("/api/me/watchlist");
    if (!res.ok) return null;
    const data = (await res.json()) as { tickers?: unknown };
    return Array.isArray(data.tickers) ? data.tickers.filter((t): t is string => typeof t === "string") : null;
  } catch {
    return null;
  }
}

export default function AppShellClient() {
  const { status, data: session } = useSession();
  const userPickedTickerRef = useRef(false);
  const [mode, setMode] = useState<"co" | "pm">("co");
  const [pmTab, setPmTab] = useState(getPMDashboardTabId(0));
  const [companyTopSection, setCompanyTopSection] = useState<CompanyTopSectionId>("overview");
  const [ticker, setTicker] = useState<string | null>(null);
  const [companyTab, setCompanyTab] = useState<string>(getFirstTabIdForTopSection("overview"));
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [eggHocOpen, setEggHocOpen] = useState(false);
  const [dailyNewsOpen, setDailyNewsOpen] = useState(false);

  const handleTickerSelect = useCallback((t: string) => {
    userPickedTickerRef.current = true;
    const sym = sanitizeTicker(t) ?? t.trim().toUpperCase();
    setTicker(sym);
    setMode("co");
    setCompanyTopSection("overview");
    setCompanyTab(getFirstTabIdForTopSection("overview"));
    void initTickerSaveFolder(sym);
  }, []);

  /** First resolved symbol: first watchlist row when signed in; placeholder when signed out or list empty. Never races past an explicit sidebar/search selection. */
  useEffect(() => {
    if (status === "loading") return;

    if (status !== "authenticated") {
      if (!userPickedTickerRef.current) setTicker(PLACEHOLDER_DEFAULT_TICKER);
      return;
    }

    let cancelled = false;
    void (async () => {
      const list = (await fetchWatchlistForShell()) ?? [];
      if (cancelled || userPickedTickerRef.current) return;
      const firstRaw = list[0]?.trim();
      const sym = firstRaw ? sanitizeTicker(firstRaw) ?? firstRaw.toUpperCase() : null;
      setTicker(sym ?? PLACEHOLDER_DEFAULT_TICKER);
    })();

    return () => {
      cancelled = true;
    };
  }, [status]);

  useEffect(() => {
    if (mode === "co" && ticker) void initTickerSaveFolder(ticker);
  }, [mode, ticker]);

  /** ROIC AI is hidden from the section bar; bounce stale state to Financials. */
  useEffect(() => {
    if (companyTopSection !== "roic-ai") return;
    setCompanyTopSection("financials");
    setCompanyTab(getFirstTabIdForTopSection("financials"));
  }, [companyTopSection]);

  /** Risk section is hidden from the section bar; bounce stale state to Overview. */
  useEffect(() => {
    if (companyTopSection !== "risk") return;
    setCompanyTopSection("overview");
    setCompanyTab(getFirstTabIdForTopSection("overview"));
  }, [companyTopSection]);

  /** Reddit tab removed; bounce saved or bookmarked state. */
  useEffect(() => {
    if (companyTab !== "reddit") return;
    setCompanyTab(getFirstTabIdForTopSection(companyTopSection));
  }, [companyTab, companyTopSection]);

  /** Broker Research Reports renamed to Broker Activities; fix bookmarked tab id. */
  useEffect(() => {
    if (companyTab !== "broker-research-reports") return;
    if (companyTopSection !== "research") setCompanyTopSection("research");
    setCompanyTab("broker-activities");
  }, [companyTab, companyTopSection]);

  /** Earnings Releases tab removed; bounce saved or bookmarked state. */
  useEffect(() => {
    if (companyTab !== "earnings-releases") return;
    if (companyTopSection !== "research") setCompanyTopSection("research");
    setCompanyTab("research-roadmap");
  }, [companyTab, companyTopSection]);

  /** Forensic Accounting tab renamed to Forensic Analysis; fix bookmarked tab id. */
  useEffect(() => {
    if (companyTab !== "forensic-accounting") return;
    if (companyTopSection !== "work-product") setCompanyTopSection("work-product");
    setCompanyTab("forensic-analysis");
  }, [companyTab, companyTopSection]);

  /** Forensic Accounting moved from Risk to Work Product; fix stale section for bookmarked state. */
  useEffect(() => {
    if (companyTab !== "forensic-analysis" || companyTopSection !== "risk") return;
    setCompanyTopSection("work-product");
  }, [companyTab, companyTopSection]);

  /** KPI tab renamed to KPI Commentary; fix bookmarked tab id. */
  useEffect(() => {
    if (companyTab !== "kpi") return;
    setCompanyTab("kpi-commentary");
  }, [companyTab]);

  /** 20-Year Look Back + SEC XBRL / SEC Filing Financials hidden from nav; land on Historical Financial Statements. */
  useEffect(() => {
    if (
      companyTab !== "20-year-look-back" &&
      companyTab !== "sec-xbrl-financials" &&
      companyTab !== "sec-filing-financials"
    ) {
      return;
    }
    if (companyTopSection !== "financials") setCompanyTopSection("financials");
    setCompanyTab("historical-financial-statements");
  }, [companyTab, companyTopSection]);

  /** PM Dashboard is restricted to the risk-checklist account. */
  useEffect(() => {
    if (mode !== "pm") return;
    if (!canAccessRiskChecklist(session?.user?.email)) {
      setMode("co");
    }
  }, [mode, session?.user?.email]);

  const handlePmTickerSelect = useCallback(
    (t: string) => {
      handleTickerSelect(t);
      setCompanyTopSection("risk-checklist");
      setCompanyTab(getFirstTabIdForTopSection("risk-checklist"));
    },
    [handleTickerSelect]
  );

  return (
    <div
      className="shell"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        maxHeight: "100dvh",
        overflow: "hidden",
      }}
    >
      <TopNav
        mode={mode}
        onModeChange={setMode}
        onOpenDailyNews={() => {
          setAiChatOpen(false);
          setEggHocOpen(false);
          setDailyNewsOpen(true);
        }}
        onOpenEggHocCommittee={() => {
          unlockEggHocNotificationAudio();
          setAiChatOpen(false);
          setDailyNewsOpen(false);
          setEggHocOpen(true);
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        {mode !== "pm" ? (
          <LeftSidebar onTickerSelect={handleTickerSelect} currentTicker={ticker} />
        ) : null}
        <div className="main flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === "co" ? (
            ticker === null ? (
              <div
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6"
                style={{ color: "var(--muted2)" }}
              >
                <p className="text-sm">Loading…</p>
              </div>
            ) : (
            <CompanyAnalysis
              ticker={ticker}
              activeTab={companyTab}
              onTabChange={setCompanyTab}
              onTickerSelect={handleTickerSelect}
              topSection={companyTopSection}
              onTopSectionChange={(s) => {
                setCompanyTopSection(s);
                setCompanyTab(getFirstTabIdForTopSection(s));
              }}
              aiChatOpen={aiChatOpen}
              onOpenAiChat={() => {
                setEggHocOpen(false);
                setDailyNewsOpen(false);
                setAiChatOpen(true);
              }}
            />
            )
          ) : canAccessRiskChecklist(session?.user?.email) ? (
            <PMDashboard activeTab={pmTab} onTabChange={setPmTab} onTickerSelect={handlePmTickerSelect} />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto p-6">
              <Card title="PM Dashboard" className="w-full max-w-lg">
                <p className="px-4 py-6 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
                  PM Dashboard is not available for this account.
                </p>
              </Card>
            </div>
          )}
        </div>
      </div>
      <ChatDrawer
        open={aiChatOpen}
        onOpen={() => {
          setEggHocOpen(false);
          setDailyNewsOpen(false);
          setAiChatOpen(true);
        }}
        onClose={() => setAiChatOpen(false)}
        ticker={ticker}
      />
      <EggHocCommitteeDrawer
        open={eggHocOpen}
        onOpen={() => {
          setAiChatOpen(false);
          setDailyNewsOpen(false);
          setEggHocOpen(true);
        }}
        onClose={() => setEggHocOpen(false)}
      />
      <DailyNewsDrawer open={dailyNewsOpen} onClose={() => setDailyNewsOpen(false)} />
    </div>
  );
}

