import type { AnalystActionType, AnalystActivityEvent, BrokerActivitySummary } from "./types";

const DAY_MS = 86_400_000;

function daysAgo(n: number): number {
  return Date.now() - n * DAY_MS;
}

function parseDateMs(d: string | null): number | null {
  if (!d) return null;
  const t = new Date(d).getTime();
  return Number.isNaN(t) ? null : t;
}

function countInWindow(events: AnalystActivityEvent[], days: number): number {
  const cutoff = daysAgo(days);
  return events.filter((e) => {
    const ms = parseDateMs(e.eventDate);
    return ms != null && ms >= cutoff;
  }).length;
}

function countAction(events: AnalystActivityEvent[], types: AnalystActionType | AnalystActionType[]): number {
  const set = new Set(Array.isArray(types) ? types : [types]);
  return events.filter((e) => set.has(e.actionType)).length;
}

export function buildBrokerActivitySummary(
  events: AnalystActivityEvent[],
  coverageBrokerCount: number
): BrokerActivitySummary {
  const dated = events
    .map((e) => parseDateMs(e.eventDate))
    .filter((ms): ms is number => ms != null)
    .sort((a, b) => b - a);

  const pts = events
    .map((e) => e.priceTargetCurrent)
    .filter((pt): pt is number => pt != null && Number.isFinite(pt));

  const latestMs = dated[0] ?? null;
  const staleCoverageWarning =
    events.length === 0 ? coverageBrokerCount > 0 : latestMs != null && latestMs < daysAgo(180);

  return {
    activeCoveringBrokers: coverageBrokerCount,
    eventsLast30Days: countInWindow(events, 30),
    eventsLast90Days: countInWindow(events, 90),
    eventsLast180Days: countInWindow(events, 180),
    eventsLast365Days: countInWindow(events, 365),
    upgradeCount: countAction(events, "upgraded"),
    downgradeCount: countAction(events, "downgraded"),
    initiationCount: countAction(events, "initiated_coverage"),
    priceTargetRaiseCount: countAction(events, "price_target_raised"),
    priceTargetCutCount: countAction(events, "price_target_lowered"),
    latestActivityDate: latestMs != null ? new Date(latestMs).toISOString().slice(0, 10) : null,
    avgPriceTarget: pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null,
    highPriceTarget: pts.length ? Math.max(...pts) : null,
    lowPriceTarget: pts.length ? Math.min(...pts) : null,
    staleCoverageWarning,
  };
}
