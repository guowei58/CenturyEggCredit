"use client";

import { pmDashboardTabIds } from "@/lib/tabs";
import { pmDashboardTabs } from "@/data/mock";
import {
  mockScreenerResults,
  mockRelativeValue,
  mockDistressed,
  mockPortfolioSummary,
  mockPortfolioHoldings,
  mockTechnicalsPrice,
  mockIdeas,
} from "@/data/mock";
import { Card, DataTable, MetricTile, TabBar } from "@/components/ui";

const pmTabs = pmDashboardTabs.map((label, i) => ({
  id: pmDashboardTabIds[i],
  label,
}));

export function PMDashboard({
  activeTab,
  onTabChange,
}: {
  activeTab: string;
  onTabChange: (tab: string) => void;
}) {
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <TabBar
        tabs={pmTabs}
        activeId={activeTab}
        onSelect={(id) => onTabChange(id)}
        variant="pm"
      />
      <div className="flex-1 overflow-y-auto px-6 py-5">
        <PMTabContent tabId={activeTab} />
      </div>
    </div>
  );
}

function PMTabContent({ tabId }: { tabId: string }) {
  if (tabId === "screeners") {
    return (
      <Card title="HY / IG Screener">
        <DataTable>
          <thead>
            <tr>
              <th>Ticker</th>
              <th>Name</th>
              <th>Sector</th>
              <th className="text-right">Rating</th>
              <th className="text-right">Spread (bps)</th>
              <th className="text-right">Price</th>
            </tr>
          </thead>
          <tbody>
            {mockScreenerResults.map((r) => (
              <tr key={r.ticker}>
                <td className="font-mono" style={{ color: "var(--accent)" }}>{r.ticker}</td>
                <td style={{ color: "var(--muted2)" }}>{r.name}</td>
                <td style={{ color: "var(--muted2)" }}>{r.sector}</td>
                <td className="text-right font-mono">{r.rating}</td>
                <td className="text-right font-mono">{r.spread}</td>
                <td className="text-right font-mono">{r.price}c</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    );
  }
  if (tabId === "relative-value") {
    return (
      <Card title="Relative Value — Telecom Peers">
        <DataTable>
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="text-right">Spread (bps)</th>
              <th className="text-right">Duration</th>
              <th className="text-right">Rating</th>
              <th>Sector</th>
            </tr>
          </thead>
          <tbody>
            {mockRelativeValue.map((r) => (
              <tr key={r.ticker}>
                <td className="font-mono" style={{ color: "var(--text)" }}>{r.ticker}</td>
                <td className="text-right font-mono">{r.spread}</td>
                <td className="text-right font-mono">{r.duration}</td>
                <td className="text-right font-mono">{r.rating}</td>
                <td style={{ color: "var(--muted2)" }}>{r.sector}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
        <div className="mt-4 rounded-lg border border-dashed py-6" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
          <p className="text-center text-[10px]" style={{ color: "var(--muted)" }}>Spread curve / OAS chart placeholder</p>
        </div>
      </Card>
    );
  }
  if (tabId === "distressed") {
    return (
      <Card title="Distressed Watchlist">
        <DataTable>
          <thead>
            <tr>
              <th>Ticker</th>
              <th className="text-right">Price (c)</th>
              <th className="text-right">Spread (bps)</th>
              <th>Comment</th>
            </tr>
          </thead>
          <tbody>
            {mockDistressed.map((r) => (
              <tr key={r.ticker}>
                <td className="font-mono" style={{ color: "var(--accent)" }}>{r.ticker}</td>
                <td className="text-right font-mono" style={{ color: "var(--danger)" }}>{r.price}</td>
                <td className="text-right font-mono">{r.spread}</td>
                <td style={{ color: "var(--muted2)" }}>{r.comment}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    );
  }
  if (tabId === "portfolio") {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {mockPortfolioSummary.map((s) => (
            <MetricTile key={s.label} label={s.label} value={s.value} valueColor="var(--accent)" />
          ))}
        </div>
        <Card title="Holdings">
          <DataTable>
            <thead>
              <tr>
                <th>Position</th>
                <th className="text-right">Amount ($M)</th>
                <th className="text-right">MV ($M)</th>
                <th className="text-right">Spread (bps)</th>
              </tr>
            </thead>
            <tbody>
              {mockPortfolioHoldings.map((h) => (
                <tr key={h.ticker}>
                  <td className="font-mono" style={{ color: "var(--text)" }}>{h.ticker}</td>
                  <td className="text-right font-mono">{h.amount}</td>
                  <td className="text-right font-mono">{h.mv}</td>
                  <td className="text-right font-mono">{h.spread}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </Card>
      </div>
    );
  }
  if (tabId === "technicals") {
    return (
      <Card title="Price / Technicals">
        <div className="mb-4 flex items-end gap-2 rounded-lg border py-6" style={{ borderColor: "var(--border)", background: "var(--card2)" }}>
          {mockTechnicalsPrice.map((p) => (
            <div key={p.date} className="flex-1 text-center">
              <div
                className="mx-auto w-full max-w-[48px] rounded-t"
                style={{ height: `${Math.max(20, (p.value / 85) * 80)}px`, background: "var(--accent)" }}
              />
              <div className="mt-2 font-mono text-[10px]" style={{ color: "var(--muted)" }}>{p.date}</div>
              <div className="font-mono text-[10px]" style={{ color: "var(--muted2)" }}>{p.value}c</div>
            </div>
          ))}
        </div>
        <p className="text-[10px]" style={{ color: "var(--muted)" }}>Mock bond price trend. Real data would drive chart.</p>
      </Card>
    );
  }
  if (tabId === "ideas-alerts") {
    return (
      <div className="space-y-4">
        <div className="card-header" style={{ marginTop: 0 }}>Ideas & Alerts</div>
        <div className="space-y-3">
          {mockIdeas.map((idea) => (
            <div
              key={idea.ticker}
              className="rounded-lg border p-4"
              style={{ background: "var(--card2)", borderColor: "var(--border)" }}
            >
              <div className="mb-3 flex items-center gap-3">
                <span className="font-mono text-sm font-semibold" style={{ color: "var(--accent)" }}>
                  {idea.ticker}
                </span>
                <span
                  className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                    idea.side === "Long" ? "bg-[var(--green)]/10 text-[var(--green)]" : "bg-[var(--danger)]/10 text-[#f87171]"
                  }`}
                >
                  {idea.side}
                </span>
              </div>
              <p className="mb-3 text-sm leading-relaxed" style={{ color: "var(--muted2)" }}>
                {idea.thesis}
              </p>
              <div className="flex gap-6 text-xs font-mono" style={{ color: "var(--muted)" }}>
                <span>Spread: {idea.spread}</span>
                <span>Rating: {idea.rating}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }
  return (
    <Card>
      <p className="text-sm" style={{ color: "var(--muted2)" }}>Tab: {tabId}</p>
    </Card>
  );
}
