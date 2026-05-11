/**
 * Heuristic “how well does this row match the keyword search?” — not EPA/USPTO/FCC ground truth.
 * Tokenize the query (ignore punctuation); significant tokens = length > 2.
 * High: every significant token appears somewhere in the haystacks.
 * Medium: at least one significant token appears.
 * Low: no token hit (often a broad API hit unrelated to the phrasing you used).
 */
export type MatchConfidence = "High" | "Medium" | "Low";

export function matchConfidenceFromQuery(
  query: string | null | undefined,
  haystacks: (string | null | undefined)[]
): MatchConfidence {
  const raw = (query ?? "").trim();
  if (!raw) return "Low";
  const q = raw.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  if (words.length === 0) return "Low";
  const combined = haystacks.map((h) => (h ?? "").toLowerCase()).join(" ");
  const hits = words.filter((w) => combined.includes(w));
  if (hits.length >= words.length) return "High";
  if (hits.length > 0) return "Medium";
  return "Low";
}

export function confidenceLevelColors(c: MatchConfidence): { bg: string; fg: string; border: string } {
  if (c === "High") return { bg: "rgba(34,197,94,0.14)", fg: "#86efac", border: "rgba(34,197,94,0.35)" };
  if (c === "Medium") return { bg: "rgba(234,179,8,0.14)", fg: "#fde68a", border: "rgba(234,179,8,0.35)" };
  return { bg: "rgba(239,68,68,0.10)", fg: "#fecaca", border: "rgba(239,68,68,0.28)" };
}
