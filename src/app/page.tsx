"use client";

import { useState, useEffect, useCallback } from "react";
import { initTickerSaveFolder } from "@/lib/saved-data-client";
import { TopNav, LeftSidebar, ChatDrawer, EggHocCommitteeDrawer } from "@/components/layout";
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
        aiChatOpen={aiChatOpen}
        onOpenAiChat={() => {
          setEggHocOpen(false);
          setAiChatOpen(true);
        }}
        onOpenEggHocCommittee={() => {
          unlockEggHocNotificationAudio();
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
      />
    </div>
  );
}
