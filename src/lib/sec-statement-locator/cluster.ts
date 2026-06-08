import type { FilingSectionBounds, LocatedPacket, NearMissPacket, RejectedCandidate, ScoredBlock, StatementKind } from "./types";
import { TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START } from "./signals";

const MAX_CLUSTER_SPAN_10Q = 45_000;
const MAX_CLUSTER_SPAN_10K = 95_000;

function maxClusterSpan(form: string): number {
  return form.includes("10-Q") ? MAX_CLUSTER_SPAN_10Q : MAX_CLUSTER_SPAN_10K;
}

function clusterDistancePenalty(span: number): number {
  return Math.floor(span / 2_000);
}

function scorePacket(
  is: ScoredBlock,
  bs: ScoredBlock,
  cf: ScoredBlock,
  form: string,
  section: FilingSectionBounds
): { clusterScore: number; span: number; reasons: string[] } {
  const offsets = [is.startOffset, bs.startOffset, cf.startOffset];
  const span = Math.max(...offsets) - Math.min(...offsets);
  const reasons: string[] = ["cluster_packet"];
  let clusterScore =
    is.kindScores.is.score + bs.kindScores.bs.score + cf.kindScores.cf.score - clusterDistancePenalty(span);

  if (is.id === bs.id || is.id === cf.id || bs.id === cf.id) {
    clusterScore -= 200;
    reasons.push("duplicate_block_in_packet");
  }

  const maxSpan = maxClusterSpan(form);
  if (span > maxSpan) {
    clusterScore -= 150 + Math.floor((span - maxSpan) / 1_000);
    reasons.push("cluster_span_exceeded");
  } else if (span < 12_000) {
    clusterScore += 25;
    reasons.push("tight_cluster");
  }

  const order = [bs.startOffset, is.startOffset, cf.startOffset].sort((a, b) => a - b);
  const isBetween = is.startOffset >= order[0]! && is.startOffset <= order[2]!;
  if (!isBetween) {
    clusterScore -= 20;
    reasons.push("is_not_between_bs_cf");
  }

  const bsCfAnchor = Math.min(bs.startOffset, cf.startOffset);
  const isDistFromAnchor = is.startOffset - bsCfAnchor;
  if (isDistFromAnchor > 30_000) {
    clusterScore -= 140 + Math.floor((isDistFromAnchor - 30_000) / 1_000);
    reasons.push("is_too_far_from_bs_cf");
  } else if (isDistFromAnchor <= 8_000) {
    clusterScore += 20;
    reasons.push("is_near_bs_cf");
  }

  if (form.includes("10-Q")) {
    const earliest = Math.min(is.startOffset, bs.startOffset, cf.startOffset);
    const distFromItemStart = earliest - section.start;
    if (distFromItemStart <= 14_000) {
      clusterScore += 50;
      reasons.push("ten_q_cluster_in_first_pages");
    } else if (distFromItemStart > TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START) {
      clusterScore -= 200;
      reasons.push("ten_q_cluster_past_primary_window");
    }
  }

  return { clusterScore, span, reasons };
}

function tenQPrimaryWindowEnd(section: FilingSectionBounds): number {
  return section.start + TEN_Q_PRIMARY_FACE_MAX_CHARS_FROM_ITEM_START;
}

function inTenQPrimaryWindow(block: ScoredBlock, section: FilingSectionBounds): boolean {
  return block.startOffset <= tenQPrimaryWindowEnd(section);
}

function sortKindCandidatesForForm(
  blocks: ScoredBlock[],
  kind: StatementKind,
  form: string,
  section: FilingSectionBounds,
  anchorOffset?: number
): ScoredBlock[] {
  const scoreOf = (block: ScoredBlock) => block.kindScores[kind].score;

  if (form.includes("10-Q")) {
    const isRevenueScore = (block: ScoredBlock) => {
      const labels = block.rowLabels.join("\n").toLowerCase();
      return (
        (/\b(?:net\s+)?revenues?\b/.test(labels) ? 30 : 0) +
        (/\bgross\s+profit\b/.test(labels) ? 20 : 0) +
        (/\boperating\s+(?:income|expenses)\b/.test(labels) ? 10 : 0)
      );
    };
    return [...blocks].sort((a, b) => {
      if (kind === "is") {
        const revGap = isRevenueScore(b) - isRevenueScore(a);
        if (revGap !== 0) return revGap;
      }
      const posA = a.startOffset - section.start;
      const posB = b.startOffset - section.start;
      const scoreGap = scoreOf(b) - scoreOf(a);
      if (scoreGap > 70) return scoreGap;
      if (Math.abs(posA - posB) > 2_500) return posA - posB;
      return scoreGap;
    });
  }

  if (anchorOffset != null && kind === "is") {
    return [...blocks].sort((a, b) => {
      const distA = Math.abs(a.startOffset - anchorOffset);
      const distB = Math.abs(b.startOffset - anchorOffset);
      if (Math.abs(distA - distB) > 4_000) return distA - distB;
      return scoreOf(b) - scoreOf(a);
    });
  }

  return [...blocks].sort((a, b) => scoreOf(b) - scoreOf(a));
}

function buildCandidatePools(
  blocks: ScoredBlock[],
  section: FilingSectionBounds,
  form: string
): {
  pools: Record<StatementKind, ScoredBlock[]>;
  usedEarlyWindowOnly: boolean;
} {
  const isTenQ = form.includes("10-Q");
  const poolBlocks = (source: ScoredBlock[]) => {
    const byKind: Record<StatementKind, ScoredBlock[]> = { is: [], bs: [], cf: [] };
    for (const block of source) {
      for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
        const ks = block.kindScores[kind];
        if (ks.score >= 35 && ks.penalties.length < 5) {
          byKind[kind].push(block);
        }
      }
    }
    return byKind;
  };

  if (!isTenQ) {
    return { pools: poolBlocks(blocks), usedEarlyWindowOnly: false };
  }

  const earlyBlocks = blocks.filter((block) => inTenQPrimaryWindow(block, section));
  const earlyPools = poolBlocks(earlyBlocks);
  const hasTrio =
    earlyPools.is.length > 0 && earlyPools.bs.length > 0 && earlyPools.cf.length > 0;
  if (hasTrio) {
    return { pools: earlyPools, usedEarlyWindowOnly: true };
  }
  return { pools: poolBlocks(blocks), usedEarlyWindowOnly: false };
}

export function findBestStatementPacket(
  blocks: ScoredBlock[],
  section: FilingSectionBounds,
  form: string
): {
  packet: LocatedPacket | null;
  rejected: RejectedCandidate[];
  nearMisses: NearMissPacket[];
} {
  const rejected: RejectedCandidate[] = [];
  const nearMisses: NearMissPacket[] = [];

  for (const block of blocks) {
    for (const kind of ["is", "bs", "cf"] as StatementKind[]) {
      const ks = block.kindScores[kind];
      if (ks.score >= 20 && ks.score < 35) {
        rejected.push({
          blockId: block.id,
          kind,
          score: ks.score,
          reason: ks.penalties[0] ?? "below_kind_threshold",
        });
      }
    }
  }

  const { pools: byKind, usedEarlyWindowOnly } = buildCandidatePools(blocks, section, form);
  if (usedEarlyWindowOnly) {
    nearMisses.push({
      kinds: {},
      clusterScore: 0,
      span: 0,
      reason: "ten_q_early_item1_window",
    });
  }

  if (byKind.is.length === 0 || byKind.bs.length === 0 || byKind.cf.length === 0) {
    nearMisses.push({
      kinds: {
        is: byKind.is[0]?.id,
        bs: byKind.bs[0]?.id,
        cf: byKind.cf[0]?.id,
      },
      clusterScore: 0,
      span: 0,
      reason: "missing_kind_candidate",
    });
    return { packet: null, rejected, nearMisses };
  }

  const bsCandidates = sortKindCandidatesForForm(byKind.bs, "bs", form, section).slice(0, 6);
  const cfCandidates = sortKindCandidatesForForm(byKind.cf, "cf", form, section).slice(0, 6);
  const bsCfAnchor = Math.min(
    bsCandidates[0]?.startOffset ?? Number.MAX_SAFE_INTEGER,
    cfCandidates[0]?.startOffset ?? Number.MAX_SAFE_INTEGER
  );
  const isCandidates = sortKindCandidatesForForm(byKind.is, "is", form, section, bsCfAnchor).slice(0, 8);

  let best: LocatedPacket | null = null;
  const considered: Array<{ packet: LocatedPacket; score: number }> = [];

  for (const is of isCandidates) {
    for (const bs of bsCandidates) {
      for (const cf of cfCandidates) {
        const { clusterScore, span, reasons } = scorePacket(is, bs, cf, form, section);
        const packet: LocatedPacket = { is, bs, cf, clusterScore, span, reasons };
        considered.push({ packet, score: clusterScore });
        if (!best || clusterScore > best.clusterScore) best = packet;
      }
    }
  }

  considered.sort((a, b) => b.score - a.score);
  for (const entry of considered.slice(1, 4)) {
    nearMisses.push({
      kinds: { is: entry.packet.is.id, bs: entry.packet.bs.id, cf: entry.packet.cf.id },
      clusterScore: entry.packet.clusterScore,
      span: entry.packet.span,
      reason: "lower_cluster_score",
    });
  }

  if (best && form.includes("10-Q")) {
    const pastWindow = [best.is, best.bs, best.cf].some(
      (block) => !inTenQPrimaryWindow(block, section)
    );
    if (pastWindow) {
      rejected.push({
        blockId: best.is.id,
        kind: "is",
        score: best.clusterScore,
        reason: "ten_q_packet_outside_primary_window",
      });
      nearMisses.push({
        kinds: { is: best.is.id, bs: best.bs.id, cf: best.cf.id },
        clusterScore: best.clusterScore,
        span: best.span,
        reason: "ten_q_packet_past_item1_face_tables",
      });
      return { packet: null, rejected, nearMisses };
    }
  }

  if (best) {
    const isFarFromAnchor =
      best.is.startOffset > best.bs.startOffset + 25_000 &&
      best.is.startOffset > best.cf.startOffset + 25_000;
    if (isFarFromAnchor) {
      rejected.push({
        blockId: best.is.id,
        kind: "is",
        score: best.clusterScore,
        reason: "is_disconnected_from_bs_cf_cluster",
      });
      nearMisses.push({
        kinds: { is: best.is.id, bs: best.bs.id, cf: best.cf.id },
        clusterScore: best.clusterScore,
        span: best.span,
        reason: "is_far_from_bs_cf_anchor",
      });
      return { packet: null, rejected, nearMisses };
    }
  }

  if (!best || best.clusterScore < (form.includes("10-Q") ? 120 : 100)) {
    nearMisses.push({
      kinds: best ? { is: best.is.id, bs: best.bs.id, cf: best.cf.id } : {},
      clusterScore: best?.clusterScore ?? 0,
      span: best?.span ?? 0,
      reason: "cluster_score_below_floor",
    });
    return { packet: null, rejected, nearMisses };
  }

  const sectionMid = section.start + (section.end - section.start) * 0.5;
  if (best.span > maxClusterSpan(form) * 1.2) {
    rejected.push({ blockId: best.is.id, kind: "is", score: best.clusterScore, reason: "packet_too_dispersed" });
    return { packet: null, rejected, nearMisses };
  }
  if (best.is.startOffset > sectionMid + 40_000 && best.bs.startOffset < sectionMid) {
    nearMisses.push({
      kinds: { is: best.is.id, bs: best.bs.id, cf: best.cf.id },
      clusterScore: best.clusterScore,
      span: best.span,
      reason: "is_far_from_bs_cf_anchor",
    });
  }

  return { packet: best, rejected, nearMisses };
}
