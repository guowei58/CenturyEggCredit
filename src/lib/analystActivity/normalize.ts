import type { AnalystActionType, RatingBucket } from "./types";

const BULLISH = /\b(buy|outperform|overweight|positive|strong\s+buy|accumulate|top\s+pick)\b/i;
const NEUTRAL = /\b(hold|neutral|equal[\s-]?weight|market\s+perform|sector\s+perform|in[\s-]?line|peer\s+perform|mixed)\b/i;
const BEARISH = /\b(sell|underperform|underweight|negative|reduce|avoid)\b/i;

export function ratingToBucket(rating: string | null | undefined): RatingBucket {
  if (!rating?.trim()) return "unknown";
  const t = rating.trim();
  if (BULLISH.test(t)) return "bullish";
  if (BEARISH.test(t)) return "bearish";
  if (NEUTRAL.test(t)) return "neutral";
  return "unknown";
}

const ACTION_PATTERNS: { type: AnalystActionType; re: RegExp }[] = [
  { type: "initiated_coverage", re: /\b(initiat(?:e|es|ed|ing)|start(?:s|ed|ing)?\s+coverage|launches?\s+coverage|begins?\s+coverage)\b/i },
  { type: "resumed_coverage", re: /\b(resum(?:e|es|ed|ing)\s+coverage|reinstates?\s+coverage)\b/i },
  { type: "coverage_dropped", re: /\b(drops?\s+coverage|suspend(?:s|ed|ing)\s+coverage|terminates?\s+coverage|coverage\s+dropped)\b/i },
  { type: "upgraded", re: /\b(upgrad(?:e|es|ed|ing)|raises?\s+rating|lift(?:s|ed|ing)\s+rating|boost(?:s|ed|ing)\s+rating)\b/i },
  { type: "downgraded", re: /\b(downgrad(?:e|es|ed|ing)|cut(?:s|ting)?\s+rating|lower(?:s|ed|ing)\s+rating|reduce(?:s|d|ing)\s+rating)\b/i },
  { type: "reiterated", re: /\b(reiterat(?:e|es|ed|ing)|reaffirm(?:s|ed|ing))\b/i },
  { type: "maintained", re: /\b(maintain(?:s|ed|ing)|keep(?:s|ing)\s+(?:a\s+)?(?:buy|hold|sell|rating|outperform|underperform))\b/i },
  { type: "price_target_raised", re: /\b(raises?\s+(?:price\s+)?target|boost(?:s|ed|ing)\s+(?:price\s+)?target|lift(?:s|ed|ing)\s+(?:price\s+)?target|increases?\s+(?:price\s+)?target|hikes?\s+(?:price\s+)?target|raises?\s+pt|boosts?\s+pt|lifts?\s+pt)\b/i },
  { type: "price_target_lowered", re: /\b(cut(?:s|ting)?\s+(?:price\s+)?target|lower(?:s|ed|ing)\s+(?:price\s+)?target|reduce(?:s|d|ing)\s+(?:price\s+)?target|trim(?:s|med|ming)\s+(?:price\s+)?target|cuts?\s+pt|lowers?\s+pt|reduces?\s+pt)\b/i },
  { type: "price_target_changed", re: /\b(price\s+target\s+(?:to|at|of)|pt\s+(?:to|at|of)|target\s+price\s+(?:to|at|of))\b/i },
  { type: "estimate_revision", re: /\b(estimate\s+revision|eps\s+estimate|revis(?:e|es|ed|ing)\s+estimates?)\b/i },
];

export function parseActionType(text: string): AnalystActionType {
  const combined = text.trim();
  if (!combined) return "unknown";
  for (const { type, re } of ACTION_PATTERNS) {
    if (re.test(combined)) return type;
  }
  return "unknown";
}

const RATING_FROM = /\b(?:from|was)\s+["']?([A-Za-z][\w\s-]{0,30}?)["']?\s+(?:to|→)/i;
const RATING_TO = /\b(?:to|at)\s+["']?(Buy|Hold|Sell|Outperform|Underperform|Overweight|Underweight|Neutral|Equal[\s-]?Weight|Market\s+Perform|Positive|Negative)\b/i;
const RATING_STANDALONE = /\b(Buy|Hold|Sell|Outperform|Underperform|Overweight|Underweight|Neutral|Equal[\s-]?Weight|Market\s+Perform|Positive|Negative)\b/i;

export function extractRatings(text: string): { prior: string | null; current: string | null } {
  const fromMatch = text.match(RATING_FROM);
  const toMatch = text.match(RATING_TO);
  if (fromMatch && toMatch) {
    return { prior: fromMatch[1].trim(), current: toMatch[1].trim() };
  }
  const standalone = text.match(RATING_STANDALONE);
  if (standalone) return { prior: null, current: standalone[1].trim() };
  return { prior: null, current: null };
}

const BROKER_PATTERNS = [
  /\b(J\.?P\.?\s*Morgan|JPMorgan(?:\s+Securities)?|Goldman\s+Sachs|Morgan\s+Stanley|BofA(?:\s+Securities)?|Bank\s+of\s+America(?:\s+Securities)?|Citigroup|Citi(?:\s+Research)?|Barclays|Deutsche\s+Bank|UBS|Jefferies|Wells\s+Fargo|RBC(?:\s+Capital(?:\s+Markets)?)?|Truist(?:\s+Securities)?|BMO(?:\s+Capital\s+Markets)?|TD(?:\s+(?:Securities|Cowen))?|Cowen|Stephens(?:\s+Inc\.?)?|Raymond\s+James|Piper\s+Sandler|Stifel|KeyBanc(?:\s+Capital\s+Markets)?|William\s+Blair|Needham(?:\s+&\s+Company)?|Canaccord(?:\s+Genuity)?|Robert\s+W\.?\s+Baird|Baird|Evercore(?:\s+ISI)?|Bernstein|Mizuho|Nomura|Macquarie|Credit\s+Suisse|HSBC|Oppenheimer|Wedbush|B\.?\s+Riley(?:\s+Securities)?)\b/i,
];

export function extractBrokerFromText(text: string): string | null {
  for (const re of BROKER_PATTERNS) {
    const m = text.match(re);
    if (m) return m[1];
  }
  return null;
}

const ANALYST_RE = /\b([A-Z][a-z]+(?:\s+[A-Z]\.?\s*)?[A-Z][a-z]+)\s+(?:at|from|of)\s+(?:J\.?P\.?\s*Morgan|Goldman|Morgan\s+Stanley|BofA|Barclays|UBS|Jefferies|RBC|Wells\s+Fargo)/i;

export function extractAnalystName(text: string): string | null {
  const m = text.match(ANALYST_RE);
  return m ? m[1].trim() : null;
}

export function formatRatingChange(prior: string | null, current: string | null): string {
  if (prior && current) return `${prior} → ${current}`;
  if (current) return current;
  if (prior) return prior;
  return "—";
}

export function formatActionLabel(action: AnalystActionType): string {
  const labels: Record<AnalystActionType, string> = {
    initiated_coverage: "Initiated coverage",
    upgraded: "Upgraded",
    downgraded: "Downgraded",
    reiterated: "Reiterated",
    maintained: "Maintained",
    resumed_coverage: "Resumed coverage",
    coverage_dropped: "Coverage dropped",
    price_target_raised: "PT raised",
    price_target_lowered: "PT lowered",
    price_target_changed: "PT changed",
    estimate_revision: "Estimate revision",
    unknown: "Unknown",
  };
  return labels[action];
}
