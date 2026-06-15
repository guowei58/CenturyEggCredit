"use client";

import type { CSSProperties, ReactNode } from "react";
import { DataTable } from "@/components/ui";
import type { CreditDecisionDashboardPayload } from "@/lib/creditMemo/creditDecisionDashboardTypes";

function badgeStyle(kind: "verdict" | "risk" | "confidence", value: string): CSSProperties {
  const v = value.trim().toLowerCase();
  let bg = "color-mix(in srgb, var(--muted2) 18%, transparent)";
  let color = "var(--text)";
  let border = "var(--border2)";

  if (kind === "verdict") {
    if (v === "buy") {
      bg = "color-mix(in srgb, var(--accent) 22%, transparent)";
      color = "var(--accent)";
      border = "var(--accent)";
    } else if (v === "short") {
      bg = "color-mix(in srgb, var(--danger) 18%, transparent)";
      color = "var(--danger)";
      border = "var(--danger)";
    } else if (v === "pass") {
      bg = "color-mix(in srgb, var(--warn) 18%, transparent)";
      color = "var(--warn)";
      border = "var(--warn)";
    } else if (v === "watchlist" || v === "hold") {
      bg = "color-mix(in srgb, var(--muted) 20%, transparent)";
      color = "var(--muted2)";
    }
  }

  if (kind === "risk" || kind === "confidence") {
    if (v === "high" || v === "critical" || v === "severe" || v === "poor" || v === "weak") {
      bg = "color-mix(in srgb, var(--danger) 16%, transparent)";
      color = "var(--danger)";
    } else if (v === "medium" || v === "mixed" || v === "tight" || v === "stressed" || v === "manageable") {
      bg = "color-mix(in srgb, var(--warn) 16%, transparent)";
      color = "var(--warn)";
    } else if (v === "low" || v === "comfortable" || v === "strong" || v === "acceptable") {
      bg = "color-mix(in srgb, var(--accent) 14%, transparent)";
      color = "var(--accent)";
    }
  }

  return { background: bg, color, border: `1px solid ${border}` };
}

function Badge({ label, kind }: { label: string; kind: "verdict" | "risk" | "confidence" }) {
  if (!label?.trim()) return null;
  return (
    <span className="inline-flex rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={badgeStyle(kind, label)}>
      {label}
    </span>
  );
}

function BulletList({ items, empty = "Not enough information in saved materials." }: { items?: string[]; empty?: string }) {
  const list = (items ?? []).filter((s) => s?.trim());
  if (list.length === 0) {
    return <p className="text-xs italic" style={{ color: "var(--muted2)" }}>{empty}</p>;
  }
  return (
    <ul className="list-disc space-y-1 pl-4 text-xs leading-relaxed" style={{ color: "var(--text)" }}>
      {list.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ul>
  );
}

function SectionCard({
  title,
  defaultOpen = false,
  children,
  badge,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  badge?: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="rounded border text-sm"
      style={{ borderColor: "var(--border2)", background: "color-mix(in srgb, var(--card2) 40%, transparent)" }}
    >
      <summary className="cursor-pointer select-none px-3 py-2 font-semibold text-xs uppercase tracking-wide flex items-center justify-between gap-2" style={{ color: "var(--text)" }}>
        <span>{title}</span>
        {badge}
      </summary>
      <div className="border-t px-3 py-2" style={{ borderColor: "var(--border2)" }}>
        {children}
      </div>
    </details>
  );
}

export function CreditDecisionDashboardView({ data }: { data: CreditDecisionDashboardPayload }) {
  const v = data.credit_verdict;
  const snap = data.security_snapshot;
  const fin = data.final_decision;

  return (
    <div className="space-y-3 text-sm">
      {/* Verdict + snapshot row */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
              Credit Verdict
            </span>
            <Badge label={v?.recommendation ?? ""} kind="verdict" />
            <Badge label={v?.confidence ?? ""} kind="confidence" />
          </div>
          <div className="space-y-2 text-xs">
            <div>
              <span className="font-semibold" style={{ color: "var(--muted2)" }}>Thesis: </span>
              {v?.one_line_thesis || "—"}
            </div>
            <div>
              <span className="font-semibold" style={{ color: "var(--muted2)" }}>Bear case: </span>
              {v?.one_line_bear_case || "—"}
            </div>
          </div>
        </div>

        <div className="rounded border p-3" style={{ borderColor: "var(--border2)", background: "var(--card2)" }}>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--muted2)" }}>
            Security Snapshot
          </div>
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <div><span style={{ color: "var(--muted2)" }}>Security: </span>{snap?.security || "—"}</div>
            <div><span style={{ color: "var(--muted2)" }}>Price: </span>{snap?.price || "—"}</div>
            <div><span style={{ color: "var(--muted2)" }}>Maturity: </span>{snap?.maturity || "—"}</div>
            <div><span style={{ color: "var(--muted2)" }}>Coupon: </span>{snap?.coupon || "—"}</div>
            <div><span style={{ color: "var(--muted2)" }}>Ranking: </span>{snap?.ranking || "—"}</div>
            <div><span style={{ color: "var(--muted2)" }}>Yield/spread: </span>{snap?.yield_spread || "—"}</div>
          </div>
          {snap?.key_structural_issue ? (
            <p className="mt-2 text-xs" style={{ color: "var(--warn)" }}>
              <span className="font-semibold">Structural issue: </span>
              {snap.key_structural_issue}
            </p>
          ) : null}
        </div>
      </div>

      {/* Three-column summary */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded border p-2" style={{ borderColor: "var(--border2)" }}>
          <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--accent)" }}>Why it works</div>
          <BulletList items={v?.why_it_works} />
        </div>
        <div className="rounded border p-2" style={{ borderColor: "var(--border2)" }}>
          <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--danger)" }}>Why it fails</div>
          <BulletList items={v?.why_it_fails} />
        </div>
        <div className="rounded border p-2" style={{ borderColor: "var(--border2)" }}>
          <div className="mb-1 text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>What to monitor</div>
          <BulletList items={data.what_would_make_us_sell_or_short?.slice(0, 5)} empty="Generate dashboard for monitoring items." />
        </div>
      </div>

      <SectionCard title="Core Credit Thesis" defaultOpen>
        <BulletList items={data.core_credit_thesis} />
      </SectionCard>

      <SectionCard title="Core Bear Case">
        <BulletList items={data.core_bear_case} />
      </SectionCard>

      <SectionCard title="Must-Be-True Assumptions">
        <div className="overflow-x-auto">
          <DataTable>
            <thead>
              <tr>
                {["Assumption", "Why it matters", "Fragility", "What would break it"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.must_be_true_assumptions ?? []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-2 py-2 text-xs italic" style={{ color: "var(--muted2)" }}>
                    Not enough information in saved materials.
                  </td>
                </tr>
              ) : (
                data.must_be_true_assumptions.map((row, i) => (
                  <tr key={i} className="align-top">
                    <td className="px-2 py-1 text-xs">{row.assumption}</td>
                    <td className="px-2 py-1 text-xs">{row.why_it_matters}</td>
                    <td className="px-2 py-1 text-xs">
                      <Badge label={row.fragility} kind="risk" />
                    </td>
                    <td className="px-2 py-1 text-xs">{row.what_would_break_it}</td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>
      </SectionCard>

      <SectionCard title="Key Risks">
        <div className="overflow-x-auto">
          <DataTable>
            <thead>
              <tr>
                {["Category", "Risk", "Horizon", "Severity", "Probability", "Monitor"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.key_risks ?? []).map((row, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1 text-xs whitespace-nowrap">{row.category}</td>
                  <td className="px-2 py-1 text-xs max-w-xs">{row.risk}</td>
                  <td className="px-2 py-1 text-xs whitespace-nowrap">{row.time_horizon}</td>
                  <td className="px-2 py-1 text-xs"><Badge label={row.severity} kind="risk" /></td>
                  <td className="px-2 py-1 text-xs"><Badge label={row.probability} kind="risk" /></td>
                  <td className="px-2 py-1 text-xs">{row.indicator_to_monitor}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </SectionCard>

      <SectionCard title="Downside Scenarios">
        <div className="space-y-3">
          {(data.downside_scenarios ?? []).map((sc, i) => (
            <div key={i} className="rounded border p-2" style={{ borderColor: "var(--border2)" }}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-semibold">{sc.case_name}</span>
                {/zero|disaster|severe/i.test(sc.case_name) ? (
                  <Badge label="Severe" kind="risk" />
                ) : /mild/i.test(sc.case_name) ? (
                  <Badge label="Mild" kind="confidence" />
                ) : null}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div>
                  <div className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: "var(--muted2)" }}>What happens</div>
                  <BulletList items={sc.what_happens} />
                </div>
                <div>
                  <div className="text-[10px] font-semibold uppercase mb-0.5" style={{ color: "var(--muted2)" }}>Recovery implication</div>
                  <BulletList items={sc.recovery_implication} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Recovery View">
        <BulletList items={data.recovery_view?.summary} />
        <div className="mt-2 grid gap-2 sm:grid-cols-2 text-xs">
          <div><span style={{ color: "var(--muted2)" }}>Bull: </span>{data.recovery_view?.bull_case || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Base: </span>{data.recovery_view?.base_case || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Bear: </span>{data.recovery_view?.bear_case || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Severe bear: </span>{data.recovery_view?.severe_bear_case || "—"}</div>
        </div>
      </SectionCard>

      <SectionCard
        title="Liquidity & Refinancing"
        badge={<Badge label={data.liquidity_refinancing_view?.liquidity_rating ?? ""} kind="risk" />}
      >
        <BulletList items={data.liquidity_refinancing_view?.summary} />
        <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
          <div><span style={{ color: "var(--muted2)" }}>Refi risk: </span>{data.liquidity_refinancing_view?.refinancing_risk || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Restructuring prob.: </span>{data.liquidity_refinancing_view?.restructuring_probability || "—"}</div>
          <div className="sm:col-span-2"><span style={{ color: "var(--muted2)" }}>Key maturity: </span>{data.liquidity_refinancing_view?.key_maturity_issue || "—"}</div>
        </div>
      </SectionCard>

      <SectionCard title="LME / Creditor Violence Risk" badge={<Badge label={data.lme_risk?.risk_rating ?? ""} kind="risk" />}>
        <BulletList items={data.lme_risk?.summary} />
        <p className="mt-2 text-xs">
          <span className="font-semibold" style={{ color: "var(--muted2)" }}>Most likely creditor-unfriendly tx: </span>
          {data.lme_risk?.most_likely_creditor_unfriendly_transaction || "—"}
        </p>
      </SectionCard>

      <SectionCard title="Management Credibility" badge={<Badge label={data.management_credibility?.rating ?? ""} kind="confidence" />}>
        <BulletList items={data.management_credibility?.summary} />
      </SectionCard>

      <SectionCard title="Market Blind Spots">
        <BulletList items={data.market_blind_spots} />
      </SectionCard>

      <div className="grid gap-3 md:grid-cols-2">
        <SectionCard title="What Would Make Us Buy More">
          <BulletList items={data.what_would_make_us_buy_more} />
        </SectionCard>
        <SectionCard title="What Would Make Us Sell / Short / Avoid">
          <BulletList items={data.what_would_make_us_sell_or_short} />
        </SectionCard>
      </div>

      <SectionCard title="Monitoring Dashboard">
        <div className="overflow-x-auto">
          <DataTable>
            <thead>
              <tr>
                {["Category", "Indicator", "Bullish", "Bearish", "Source"].map((h) => (
                  <th key={h} className="px-2 py-1 text-left text-[10px] font-semibold uppercase" style={{ color: "var(--muted2)" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(data.monitoring_dashboard ?? []).map((row, i) => (
                <tr key={i} className="align-top">
                  <td className="px-2 py-1 text-xs whitespace-nowrap">{row.category}</td>
                  <td className="px-2 py-1 text-xs">{row.indicator}</td>
                  <td className="px-2 py-1 text-xs">{row.bullish_signal}</td>
                  <td className="px-2 py-1 text-xs">{row.bearish_signal}</td>
                  <td className="px-2 py-1 text-xs">{row.source_to_monitor}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </div>
      </SectionCard>

      {(data.missing_information ?? []).length > 0 ? (
        <div className="rounded border px-3 py-2" style={{ borderColor: "var(--warn)", background: "color-mix(in srgb, var(--warn) 8%, transparent)" }}>
          <div className="mb-1 text-xs font-semibold uppercase" style={{ color: "var(--warn)" }}>Missing Information</div>
          <BulletList items={data.missing_information} empty="" />
        </div>
      ) : null}

      {/* Final decision box */}
      <div className="rounded border-2 p-3" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 6%, var(--card2))" }}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide">Final Decision</span>
          <Badge label={fin?.recommendation ?? ""} kind="verdict" />
          <Badge label={fin?.confidence ?? ""} kind="confidence" />
        </div>
        <div className="grid gap-1 text-xs sm:grid-cols-2">
          <div><span style={{ color: "var(--muted2)" }}>Target / recovery: </span>{fin?.target_price_or_recovery || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Downside: </span>{fin?.downside_price_estimate || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Horizon: </span>{fin?.expected_time_horizon || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Key catalyst: </span>{fin?.key_catalyst || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Biggest risk: </span>{fin?.biggest_risk || "—"}</div>
          <div><span style={{ color: "var(--muted2)" }}>Would change view if: </span>{fin?.what_would_change_the_view || "—"}</div>
        </div>
      </div>
    </div>
  );
}
