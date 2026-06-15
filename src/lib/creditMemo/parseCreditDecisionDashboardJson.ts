import type { CreditDecisionDashboardPayload } from "./creditDecisionDashboardTypes";

function tryParseObject(raw: string): CreditDecisionDashboardPayload | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as CreditDecisionDashboardPayload;
  } catch {
    return null;
  }
}

/** Extract structured dashboard JSON from model output (raw JSON or fenced code block). */
export function parseCreditDecisionDashboardJson(raw: string): CreditDecisionDashboardPayload | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const direct = tryParseObject(trimmed);
  if (direct) return direct;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const inner = tryParseObject(fenced[1].trim());
    if (inner) return inner;
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    const slice = tryParseObject(trimmed.slice(start, end + 1));
    if (slice) return slice;
  }

  return null;
}
