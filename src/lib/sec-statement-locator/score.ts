import type { BlockKindScore, FilingSectionBounds, ScoredBlock, StatementBlock, StatementKind } from "./types";
import {
  NEGATIVE_CONTEXT_PATTERNS,
  POSITIVE_HEADINGS,
  POSITIVE_ROW_ANCHORS,
  TEN_Q_FOOTNOTE_TABLE_PATTERNS,
  IS_EQUITY_ROLLFORWARD_PATTERNS,
  TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START,
  TEN_Q_PRIMARY_FACE_STRONG_EARLY_CHARS,
  countPatternHits,
  periodStructureMatchesKind,
} from "./signals";

const KIND_BASE_SCORE = 50;

function scoreToConfidence(score: number): number {
  return Math.max(0, Math.min(1, score / 220));
}

function scoreBlockForKind(
  block: StatementBlock,
  kind: StatementKind,
  section: FilingSectionBounds,
  form: string
): BlockKindScore {
  const reasons: string[] = [];
  const penalties: string[] = [];
  let score = KIND_BASE_SCORE;

  const contextBlob = `${block.headingText} ${block.combinedText.slice(0, 4_000)}`.toLowerCase();
  const labelBlob = block.rowLabels.join("\n").toLowerCase();

  const headingHits = countPatternHits(contextBlob, POSITIVE_HEADINGS[kind]);
  if (headingHits > 0) {
    score += 60 + headingHits * 15;
    reasons.push(`positive_heading_match_${headingHits}`);
  }

  const rowHits = POSITIVE_ROW_ANCHORS[kind].filter((re) => re.test(labelBlob)).length;
  if (rowHits > 0) {
    score += Math.min(80, rowHits * 12);
    reasons.push(`row_anchor_hits_${rowHits}`);
  }

  if (block.dataRowCount >= 8) {
    score += 25;
    reasons.push("large_table");
  } else if (block.dataRowCount >= 5) {
    score += 12;
    reasons.push("medium_table");
  } else if (block.dataRowCount < 4) {
    score -= 40;
    penalties.push("too_few_rows");
  }

  if (block.valueColumnCount >= 2) {
    score += block.valueColumnCount * 8;
    reasons.push(`period_columns_${block.valueColumnCount}`);
  } else {
    score -= 30;
    penalties.push("insufficient_period_columns");
  }

  if (block.ixTagCount > 0) {
    score += Math.min(40, Math.floor(block.ixTagCount / 3));
    reasons.push(`ix_tag_density_${block.ixTagCount}`);
  }

  const periodCheck = periodStructureMatchesKind(kind, block.periodHeaders);
  if (!periodCheck.ok) {
    score -= 50;
    penalties.push(periodCheck.reason ?? "period_structure_mismatch");
  } else if (block.periodHeaders.length > 0) {
    reasons.push("period_structure_ok");
  }

  const negHits = NEGATIVE_CONTEXT_PATTERNS.filter((re) => re.test(contextBlob)).length;
  if (negHits > 0) {
    score -= negHits * 45;
    penalties.push(`negative_context_${negHits}`);
  }

  const distFromSectionStart = block.startOffset - section.start;
  const sectionLen = section.end - section.start;
  const relativePos = sectionLen > 0 ? distFromSectionStart / sectionLen : 0;

  if (form.includes("10-Q")) {
    if (distFromSectionStart <= TEN_Q_PRIMARY_FACE_STRONG_EARLY_CHARS) {
      score += 45;
      reasons.push("ten_q_first_pages");
    } else if (distFromSectionStart <= TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START) {
      score += 18;
      reasons.push("ten_q_early_item1");
    } else {
      score -= 120;
      penalties.push("ten_q_past_primary_face_window");
    }
    const footnoteBlob = `${block.headingText} ${labelBlob}`.toLowerCase();
    const footnoteHits = TEN_Q_FOOTNOTE_TABLE_PATTERNS.filter((re) => re.test(footnoteBlob)).length;
    if (footnoteHits > 0) {
      score -= footnoteHits * 55;
      penalties.push(`ten_q_footnote_cues_${footnoteHits}`);
    }
  } else if (relativePos < 0.35) {
    score += 20;
    reasons.push("early_in_section");
  } else if (relativePos > 0.85) {
    score -= 15;
    penalties.push("late_in_section");
  }

  if (form.includes("10-Q") && kind === "cf" && /\b(?:six|nine)\s+months?\s+ended\b/i.test(contextBlob)) {
    score += 10;
    reasons.push("ytd_cash_flow_cue");
  }

  if (kind === "is" && /%\s*$|\b100\s*%/m.test(block.combinedText)) {
    score -= 80;
    penalties.push("percentage_table");
  }

  if (kind === "is" && IS_EQUITY_ROLLFORWARD_PATTERNS.filter((re) => re.test(labelBlob)).length >= 2) {
    score -= 500;
    penalties.push("equity_rollforward_not_income_statement");
  }

  if (kind === "is") {
    const headingLow = block.headingText.toLowerCase();
    const hasOciHeading = /\b(?:statements?\s+of\s+)?comprehensive\s+(?:income|loss)\b/i.test(headingLow);
    const hasOciRows = /\bother comprehensive income\b/i.test(labelBlob);
    const hasRevenueCue =
      /\b(?:net\s+)?revenues?\b|\bnet\s+sales\b|\btotal\s+revenues?\b|\bgross\s+profit\b|\boperating\s+costs?\s+and\s+expenses\b|\bcontract\s+revenues?\b/i.test(
        labelBlob
      );
    if ((hasOciHeading || hasOciRows) && !hasRevenueCue) {
      score -= 500;
      penalties.push("oci_not_income_statement");
    }
    if (hasRevenueCue) {
      score += 35;
      reasons.push("is_revenue_row_anchors");
    }
  }

  if (kind === "bs" && /\bpage\b/i.test(labelBlob) && block.dataRowCount < 6) {
    score -= 100;
    penalties.push("index_listing_table");
  }

  return {
    kind,
    score,
    confidence: scoreToConfidence(score),
    reasons,
    penalties,
  };
}

export function scoreStatementBlocks(
  blocks: StatementBlock[],
  section: FilingSectionBounds,
  form: string
): ScoredBlock[] {
  return blocks.map((block) => {
    const kindScores = {
      is: scoreBlockForKind(block, "is", section, form),
      bs: scoreBlockForKind(block, "bs", section, form),
      cf: scoreBlockForKind(block, "cf", section, form),
    };
    const ranked = (["is", "bs", "cf"] as StatementKind[]).sort(
      (a, b) => kindScores[b].score - kindScores[a].score
    );
    const bestKind = ranked[0]!;
    const bestScore = kindScores[bestKind].score;
    const viable = ranked.find((k) => kindScores[k].score >= 40) ?? null;
    return {
      ...block,
      kindScores,
      bestKind: viable && kindScores[viable].score >= 40 ? viable : bestKind,
      bestScore: viable ? kindScores[viable].score : bestScore,
    };
  });
}

export function isTenQEligibleForKindPool(block: ScoredBlock, kind: StatementKind): boolean {
  const ks = block.kindScores[kind];
  if (ks.score < 35 || ks.penalties.length >= 5) return false;
  if (kind === "is") {
    if (ks.penalties.includes("oci_not_income_statement")) return false;
    if (ks.penalties.includes("equity_rollforward_not_income_statement")) return false;
  }
  return true;
}

export function pickBestBlockForKind(blocks: ScoredBlock[], kind: StatementKind, minScore = 35): ScoredBlock | null {
  const ranked = blocks
    .map((block) => ({ block, score: block.kindScores[kind] }))
    .filter((entry) => entry.score.score >= minScore && entry.score.penalties.length < 4)
    .sort((a, b) => b.score.score - a.score.score || a.block.startOffset - b.block.startOffset);
  return ranked[0]?.block ?? null;
}
