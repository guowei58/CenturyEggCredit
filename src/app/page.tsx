"use client";

import { useState, useEffect, useCallback } from "react";
import { pmDashboardTabIds } from "@/lib/tabs";
import { initTickerSaveFolder } from "@/lib/saved-data-client";
import { TopNav, LeftSidebar, ChatDrawer, EggHocCommitteeDrawer } from "@/components/layout";
import { CompanyAnalysis } from "@/components/CompanyAnalysis";
import { PMDashboard } from "@/components/PMDashboard";
import type { CompanyTopSectionId } from "@/data/company-navigation";
import { getFirstTabIdForTopSection } from "@/data/company-navigation";

export default function Home() {
  const [mode, setMode] = useState<"co" | "pm">("co");
  const [companyTopSection, setCompanyTopSection] = useState<CompanyTopSectionId>("overview");
  const [ticker, setTicker] = useState<string | null>("LUMN");
  const [companyTab, setCompanyTab] = useState<string>(getFirstTabIdForTopSection("overview"));
  const [pmTab, setPMTab] = useState(pmDashboardTabIds[0]);
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [eggHocOpen, setEggHocOpen] = useState(false);

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
        onOpenAiChat={() => {
          setEggHocOpen(false);
          setAiChatOpen(true);
        }}
        onOpenEggHocCommittee={() => {
          setAiChatOpen(false);
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
            />
          ) : (
            <PMDashboard activeTab={pmTab} onTabChange={setPMTab} />
          )}
        </div>
      </div>
      <ChatDrawer
        open={aiChatOpen}
        onOpen={() => {
          setEggHocOpen(false);
          setAiChatOpen(true);
        }}
        onClose={() => setAiChatOpen(false)}
        ticker={ticker}
      />
      <EggHocCommitteeDrawer
        open={eggHocOpen}
        onOpen={() => {
          setAiChatOpen(false);
          setEggHocOpen(true);
        }}
        onClose={() => setEggHocOpen(false)}
        ticker={ticker}
      />
    </div>
  );
}
