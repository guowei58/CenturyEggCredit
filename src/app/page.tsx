"use client";

import { useState, useEffect, useCallback } from "react";
import { initTickerSaveFolder } from "@/lib/saved-data-client";
import { TopNav, LeftSidebar, ChatDrawer, EggHocCommitteeDrawer } from "@/components/layout";
import { DailyNewsDrawer } from "@/components/daily-news/DailyNewsDrawer";
import { unlockEggHocNotificationAudio } from "@/lib/sounds/playEggHocBark";
import { CompanyAnalysis } from "@/components/CompanyAnalysis";
import { Card } from "@/components/ui";
import type { CompanyTopSectionId } from "@/data/company-navigation";
import { getFirstTabIdForTopSection } from "@/data/company-navigation";

export default function Home() {
  const [mode, setMode] = useState<"co" | "pm">("co");
  const [companyTopSection, setCompanyTopSection] = useState<CompanyTopSectionId>("overview");
  const [ticker, setTicker] = useState<string | null>("LUMN");
  const [companyTab, setCompanyTab] = useState<string>(getFirstTabIdForTopSection("overview"));
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [eggHocOpen, setEggHocOpen] = useState(false);
  const [dailyNewsOpen, setDailyNewsOpen] = useState(false);

  const handleTickerSelect = useCallback((t: string) => {
    setTicker(t);
    setMode("co");
    setCompanyTopSection("overview");
    setCompanyTab(getFirstTabIdForTopSection("overview"));
    void initTickerSaveFolder(t);
  }, []);

  useEffect(() => {
    if (mode === "co" && ticker) void initTickerSaveFolder(ticker);
  }, [mode, ticker]);

  /** ROIC AI is hidden from the section bar; bounce stale state to Financials. */
  useEffect(() => {
    if (companyTopSection !== "roic-ai") return;
    setCompanyTopSection("financials");
    setCompanyTab(getFirstTabIdForTopSection("financials"));
  }, [companyTopSection]);

  /** Reddit tab removed; bounce saved or bookmarked state. */
  useEffect(() => {
    if (companyTab !== "reddit") return;
    setCompanyTab(getFirstTabIdForTopSection(companyTopSection));
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

  /** 20-Year Look Back tab removed; land on SEC XBRL Financials. */
  useEffect(() => {
    if (companyTab !== "20-year-look-back") return;
    if (companyTopSection !== "financials") setCompanyTopSection("financials");
    setCompanyTab("sec-xbrl-financials");
  }, [companyTab, companyTopSection]);

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
        <LeftSidebar onTickerSelect={handleTickerSelect} currentTicker={ticker} />
        <div className="main flex min-h-0 flex-1 flex-col overflow-hidden">
          {mode === "co" ? (
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
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-auto p-6">
              <Card title="PM Dashboard" className="max-w-lg w-full">
                <p className="px-4 py-6 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
                  OREO is still undergoing training. This section is closed for now—check back later.
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
