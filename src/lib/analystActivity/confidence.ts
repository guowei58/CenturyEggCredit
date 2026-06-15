import type { AnalystActionType, AnalystActivityEvent, SourceType } from "./types";

const REPORT_ACTIONS: Set<AnalystActionType> = new Set([
  "initiated_coverage",
  "upgraded",
  "downgraded",
  "maintained",
  "reiterated",
  "resumed_coverage",
  "price_target_raised",
  "price_target_lowered",
  "price_target_changed",
  "estimate_revision",
]);

export function scoreEventConfidence(input: {
  sourceType: SourceType;
  hasDate: boolean;
  hasBroker: boolean;
  hasAction: boolean;
  hasRating: boolean;
  hasPriceTarget: boolean;
  hasHeadline: boolean;
}): number {
  if (input.sourceType === "company_ir_coverage") {
    return input.hasBroker ? 95 : 85;
  }
  if (input.sourceType === "finnhub_api" || input.sourceType === "fmp_api" || input.sourceType === "alphavantage_api") {
    let score = 88;
    if (input.hasDate) score += 4;
    if (input.hasBroker) score += 3;
    if (input.hasAction) score += 3;
    return Math.min(100, score);
  }

  const structuredSources: SourceType[] = ["marketbeat", "marketwatch", "investing", "briefing", "yahoo_public"];
  if (structuredSources.includes(input.sourceType)) {
    let score = 85;
    if (input.hasDate) score += 4;
    if (input.hasBroker) score += 3;
    if (input.hasAction) score += 3;
    if (input.hasRating) score += 2;
    if (input.hasPriceTarget) score += 2;
    return Math.min(100, score);
  }

  let score = 65;
  if (input.hasBroker && input.hasAction) score += 10;
  if (input.hasDate) score += 5;
  if (input.hasRating || input.hasPriceTarget) score += 5;
  if (input.hasHeadline) score += 3;
  return Math.min(84, score);
}

export function probableReportExists(
  actionType: AnalystActionType,
  headline: string,
  snippet: string | null
): boolean {
  if (REPORT_ACTIONS.has(actionType) && actionType !== "unknown") return true;
  const text = `${headline} ${snippet ?? ""}`.toLowerCase();
  return /\b(upgrad|downgrad|initiat|reiterat|maintain|resum(?:e|es|ed)\s+coverage|coverage\s+dropped|price\s+target|raises?\s+pt|cuts?\s+pt)\b/.test(text);
}

export function shouldDisplayEvent(event: AnalystActivityEvent): boolean {
  if (event.confidenceScore < 50) return false;
  if (!event.eventDate?.trim()) return false;
  if (event.broker.trim().toLowerCase() === "unknown") return false;
  return true;
}

export function filterDisplayEvents(events: AnalystActivityEvent[]): AnalystActivityEvent[] {
  return events.filter(shouldDisplayEvent);
}
