import { createHash } from "crypto";

import { normalizeBrokerName } from "./brokerAliases";
import { probableReportExists, scoreEventConfidence } from "./confidence";
import { buildDedupeKey } from "./dedupe";
import {
  extractAnalystName,
  extractBrokerFromText,
  extractRatings,
  parseActionType,
  ratingToBucket,
} from "./normalize";
import { parsePriceTargets } from "./priceTargetParse";
import { resolveSourceFromUrl } from "./searchQueries";
import type { AnalystActivityEvent, RawSearchHit, SourceType } from "./types";

function parseEventDate(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  const s = raw.trim();
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (iso) return iso[1];
  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return null;
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
}

export function hitToAnalystEvent(
  hit: RawSearchHit,
  ticker: string,
  companyName: string | null,
  retrievedAt: string,
  sourceTypeOverride?: SourceType
): AnalystActivityEvent | null {
  const combined = `${hit.title} ${hit.snippet}`;
  const actionType = parseActionType(combined);
  if (actionType === "unknown" && !/\banalyst\b/i.test(combined)) return null;

  const { sourceName, sourceType: urlSourceType } = resolveSourceFromUrl(hit.url);
  const sourceType = sourceTypeOverride ?? urlSourceType;
  const broker = normalizeBrokerName(extractBrokerFromText(combined));
  const analystName = extractAnalystName(combined);
  const { prior: ratingPrior, current: ratingCurrent } = extractRatings(combined);
  const { prior: priceTargetPrior, current: priceTargetCurrent, currency } = parsePriceTargets(combined);
  const eventDate = parseEventDate(hit.publishedDate);

  const confidenceScore = scoreEventConfidence({
    sourceType,
    hasDate: Boolean(eventDate),
    hasBroker: broker !== "Unknown",
    hasAction: actionType !== "unknown",
    hasRating: Boolean(ratingCurrent || ratingPrior),
    hasPriceTarget: priceTargetCurrent != null,
    hasHeadline: Boolean(hit.title),
  });

  const event: AnalystActivityEvent = {
    id: stableId([ticker, hit.url, hit.title]),
    ticker: ticker.toUpperCase(),
    companyName,
    eventDate,
    broker,
    analystName,
    actionType,
    ratingPrior,
    ratingCurrent,
    ratingBucketPrior: ratingToBucket(ratingPrior),
    ratingBucketCurrent: ratingToBucket(ratingCurrent),
    priceTargetPrior,
    priceTargetCurrent,
    currency,
    headline: hit.title,
    snippet: hit.snippet || null,
    sourceName,
    sourceUrl: hit.url,
    sourceType,
    retrievedAt,
    confidenceScore,
    probableReportExists: probableReportExists(actionType, hit.title, hit.snippet),
    dedupeKey: "",
  };
  event.dedupeKey = buildDedupeKey(event);
  return event;
}
