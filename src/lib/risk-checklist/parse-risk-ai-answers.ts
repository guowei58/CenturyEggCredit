import type { RiskAnswerLabel } from "./types";

const VALID_LABELS = new Set<RiskAnswerLabel>(["no", "mixed", "yes", "unknown", "not_applicable"]);

export type ParsedRiskAiAnswer = {
  questionCode: string;
  answerLabel: RiskAnswerLabel;
  rationale?: string;
};

export type ParsedRiskAiResponse = {
  answers: ParsedRiskAiAnswer[];
};

function tryParseObject(raw: string): ParsedRiskAiResponse | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const answersRaw = (parsed as { answers?: unknown }).answers;
    if (!Array.isArray(answersRaw)) return null;
    const answers: ParsedRiskAiAnswer[] = [];
    for (const row of answersRaw) {
      if (!row || typeof row !== "object") continue;
      const code = (row as { questionCode?: unknown }).questionCode;
      const label = (row as { answerLabel?: unknown }).answerLabel;
      if (typeof code !== "string" || !code.trim()) continue;
      if (typeof label !== "string" || !VALID_LABELS.has(label as RiskAnswerLabel)) continue;
      const rationale = (row as { rationale?: unknown }).rationale;
      answers.push({
        questionCode: code.trim().toUpperCase(),
        answerLabel: label as RiskAnswerLabel,
        rationale: typeof rationale === "string" && rationale.trim() ? rationale.trim() : undefined,
      });
    }
    if (answers.length === 0) return null;
    return { answers };
  } catch {
    return null;
  }
}

/** Extract structured risk answers from model output (raw JSON or fenced code block). */
export function parseRiskAiAnswersJson(raw: string): ParsedRiskAiResponse | null {
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
