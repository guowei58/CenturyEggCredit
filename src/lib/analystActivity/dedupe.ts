import { normalizeBrokerName } from "./brokerAliases";
import type { AnalystActivityEvent } from "./types";

export function buildDedupeKey(event: Pick<
  AnalystActivityEvent,
  "ticker" | "eventDate" | "broker" | "actionType" | "ratingCurrent" | "priceTargetCurrent"
>): string {
  const broker = normalizeBrokerName(event.broker).toLowerCase();
  const date = event.eventDate ?? "unknown-date";
  const rating = (event.ratingCurrent ?? "").toLowerCase().trim();
  const pt = event.priceTargetCurrent != null ? String(event.priceTargetCurrent) : "";
  return [event.ticker.toUpperCase(), date, broker, event.actionType, rating, pt].join("|");
}

function completenessScore(e: AnalystActivityEvent): number {
  let score = 0;
  if (e.eventDate) score += 2;
  if (e.analystName) score += 1;
  if (e.ratingCurrent) score += 2;
  if (e.ratingPrior) score += 1;
  if (e.priceTargetCurrent != null) score += 2;
  if (e.priceTargetPrior != null) score += 1;
  if (e.snippet) score += 1;
  score += e.confidenceScore / 100;
  return score;
}

export function dedupeEvents(events: AnalystActivityEvent[]): AnalystActivityEvent[] {
  const byKey = new Map<string, AnalystActivityEvent>();

  for (const event of events) {
    const key = event.dedupeKey || buildDedupeKey(event);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...event, dedupeKey: key });
      continue;
    }
    const merged: AnalystActivityEvent = {
      ...existing,
      secondarySourceUrls: [
        ...(existing.secondarySourceUrls ?? []),
        ...(existing.sourceUrl !== event.sourceUrl ? [event.sourceUrl] : []),
        ...(event.secondarySourceUrls ?? []),
      ].filter((url, i, arr) => arr.indexOf(url) === i && url !== existing.sourceUrl),
    };
    if (completenessScore(event) > completenessScore(existing)) {
      merged.headline = event.headline || existing.headline;
      merged.snippet = event.snippet || existing.snippet;
      merged.analystName = event.analystName || existing.analystName;
      merged.ratingPrior = event.ratingPrior ?? existing.ratingPrior;
      merged.ratingCurrent = event.ratingCurrent ?? existing.ratingCurrent;
      merged.priceTargetPrior = event.priceTargetPrior ?? existing.priceTargetPrior;
      merged.priceTargetCurrent = event.priceTargetCurrent ?? existing.priceTargetCurrent;
      merged.eventDate = event.eventDate ?? existing.eventDate;
      merged.confidenceScore = Math.max(event.confidenceScore, existing.confidenceScore);
      merged.sourceUrl = event.confidenceScore >= existing.confidenceScore ? event.sourceUrl : existing.sourceUrl;
      merged.sourceName = event.confidenceScore >= existing.confidenceScore ? event.sourceName : existing.sourceName;
    }
    byKey.set(key, merged);
  }

  return [...byKey.values()].sort((a, b) => {
    const da = a.eventDate ?? "";
    const db = b.eventDate ?? "";
    return db.localeCompare(da);
  });
}
