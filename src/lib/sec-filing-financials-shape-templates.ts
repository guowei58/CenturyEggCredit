/** Per-ticker row-shape fingerprints used to boost primary face table picks. */

export type PrimaryFaceShapeKind = "is" | "bs" | "cf";

export type PrimaryFaceShapeTemplate = {
  kind: PrimaryFaceShapeKind;
  /** Normalized data-row labels (order preserved). */
  rowLabels: string[];
  /** High-signal anchor lines for quick matching. */
  anchorLabels: string[];
  dataRowCount: number;
  sourceFilingDate?: string;
};

export type PrimaryFaceShapeTemplates = Partial<Record<PrimaryFaceShapeKind, PrimaryFaceShapeTemplate>>;

export type ShapeTemplateStatementInput = {
  id: string;
  rows: Array<{ label: string; rowKind?: string }>;
};

const KIND_BY_ID: Record<string, PrimaryFaceShapeKind | undefined> = {
  "income-statement": "is",
  "balance-sheet": "bs",
  "cash-flow": "cf",
};

const ANCHOR_PATTERNS: Record<PrimaryFaceShapeKind, RegExp[]> = {
  is: [
    /\b(?:total )?revenues?\b/,
    /\bnet sales\b/,
    /\bcost of (?:revenues?|sales|services)\b/,
    /\bgross profit\b/,
    /\boperating income\b/,
    /\bnet income\b/,
    /\bnet loss\b/,
  ],
  bs: [
    /\bcash and cash equivalents\b/,
    /\btotal current assets\b/,
    /\btotal assets\b/,
    /\btotal liabilities\b/,
    /\bstockholders'? equity\b/,
    /\bshareholders'? equity\b/,
  ],
  cf: [
    /\boperating activities\b/,
    /\binvesting activities\b/,
    /\bfinancing activities\b/,
    /\bnet cash\b/,
    /\bdepreciation\b/,
  ],
};

export function normalizeRowLabelForShape(label: string): string {
  return label
    .replace(/\(\s*note\s+\d+[^)]*\)/gi, "")
    .replace(/\(\s*\$[^)]*\)/g, "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(label: string): Set<string> {
  return new Set(
    normalizeRowLabelForShape(label)
      .split(" ")
      .filter((t) => t.length > 2)
  );
}

function labelsSimilar(a: string, b: string): boolean {
  const na = normalizeRowLabelForShape(a);
  const nb = normalizeRowLabelForShape(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const ta = tokenSet(na);
  const tb = tokenSet(nb);
  if (ta.size === 0 || tb.size === 0) return false;
  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap += 1;
  }
  const denom = Math.min(ta.size, tb.size);
  return overlap / denom >= 0.55;
}

function candidateHasAnchor(candidateLabels: string[], anchor: string): boolean {
  const normalizedAnchor = normalizeRowLabelForShape(anchor);
  return candidateLabels.some((label) => labelsSimilar(label, normalizedAnchor));
}

function kindFromStatementId(id: string): PrimaryFaceShapeKind | null {
  return KIND_BY_ID[id] ?? null;
}

/** Build a reusable fingerprint from a trusted primary face statement. */
export function buildPrimaryFaceShapeTemplateFromStatement(
  stmt: ShapeTemplateStatementInput,
  sourceFilingDate?: string
): PrimaryFaceShapeTemplate | null {
  const kind = kindFromStatementId(stmt.id);
  if (!kind) return null;

  const dataRows = stmt.rows.filter((row) => row.rowKind !== "heading");
  if (dataRows.length < 4) return null;

  const rowLabels = dataRows
    .slice(0, 28)
    .map((row) => normalizeRowLabelForShape(row.label))
    .filter(Boolean);

  const anchorLabels = dataRows
    .map((row) => row.label)
    .filter((label) => ANCHOR_PATTERNS[kind].some((re) => re.test(label.toLowerCase())))
    .slice(0, 10)
    .map((label) => normalizeRowLabelForShape(label));

  if (rowLabels.length < 4) return null;

  return {
    kind,
    rowLabels,
    anchorLabels,
    dataRowCount: dataRows.length,
    sourceFilingDate,
  };
}

/**
 * Score how closely a candidate table's row labels match a trusted template (0–150).
 * Additive only — callers merge with generic table scores.
 */
export function scoreShapeTemplateSimilarity(
  candidateLabels: string[],
  template: PrimaryFaceShapeTemplate
): number {
  if (!candidateLabels.length || !template.rowLabels.length) return 0;

  const normalizedCandidates = candidateLabels.map((label) => normalizeRowLabelForShape(label)).filter(Boolean);
  if (!normalizedCandidates.length) return 0;

  let anchorHits = 0;
  for (const anchor of template.anchorLabels) {
    if (candidateHasAnchor(candidateLabels, anchor)) anchorHits += 1;
  }
  const anchorScore =
    template.anchorLabels.length > 0
      ? Math.round((anchorHits / template.anchorLabels.length) * 55)
      : 0;

  let rowMatches = 0;
  for (let i = 0; i < template.rowLabels.length; i += 1) {
    const templateLabel = template.rowLabels[i]!;
    const windowStart = Math.max(0, i - 2);
    const windowEnd = Math.min(normalizedCandidates.length, i + 3);
    let matched = false;
    for (let j = windowStart; j < windowEnd; j += 1) {
      if (labelsSimilar(normalizedCandidates[j]!, templateLabel)) {
        matched = true;
        break;
      }
    }
    if (!matched) {
      matched = normalizedCandidates.some((label) => labelsSimilar(label, templateLabel));
    }
    if (matched) rowMatches += 1;
  }

  const rowScore = Math.round((rowMatches / template.rowLabels.length) * 85);
  const countPenalty = Math.min(30, Math.abs(normalizedCandidates.length - template.dataRowCount) * 2);
  return Math.max(0, Math.min(150, anchorScore + rowScore - countPenalty));
}

/** Merge newly trusted templates; newer filing dates win per kind. */
export function mergePrimaryFaceShapeTemplates(
  existing: PrimaryFaceShapeTemplates,
  incoming: PrimaryFaceShapeTemplates
): PrimaryFaceShapeTemplates {
  const merged: PrimaryFaceShapeTemplates = { ...existing };
  for (const kind of ["is", "bs", "cf"] as PrimaryFaceShapeKind[]) {
    const next = incoming[kind];
    if (!next) continue;
    const prev = merged[kind];
    if (!prev) {
      merged[kind] = next;
      continue;
    }
    const prevDate = prev.sourceFilingDate ?? "";
    const nextDate = next.sourceFilingDate ?? "";
    if (nextDate.localeCompare(prevDate) >= 0) merged[kind] = next;
  }
  return merged;
}

export function updatePrimaryFaceShapeTemplatesFromStatements(
  statements: ShapeTemplateStatementInput[],
  templates: PrimaryFaceShapeTemplates,
  sourceFilingDate?: string
): PrimaryFaceShapeTemplates {
  const incoming: PrimaryFaceShapeTemplates = {};
  for (const stmt of statements) {
    const built = buildPrimaryFaceShapeTemplateFromStatement(stmt, sourceFilingDate);
    if (built) incoming[built.kind] = built;
  }
  return mergePrimaryFaceShapeTemplates(templates, incoming);
}
