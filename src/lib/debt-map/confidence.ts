/**
 * Conservative 0–100 confidence for deterministic extraction heuristics.
 * See product spec: party block / definition / schedule / signature ordering.
 */
export function confidencePartyBlockLine(): number {
  return 94;
}

export function confidenceDefinedTermBlock(): number {
  return 88;
}

export function confidenceScheduleHeading(): number {
  return 78;
}

export function confidenceKeywordInference(): number {
  return 58;
}

export function confidenceCandidateOnly(): number {
  return 42;
}

export function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
