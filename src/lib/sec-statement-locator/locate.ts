import type { PrimaryFaceShapeTemplates } from "@/lib/sec-filing-financials-shape-templates";
import { buildStatementBlocks } from "./blocks";
import { findBestStatementPacket } from "./cluster";
import { scoreStatementBlocks } from "./score";
import { locateFinancialStatementsSection } from "./section";
import type { LocatorContext, LocatorResult, LocatedPacket } from "./types";

export type LocateOptions = {
  form: string;
  shapeTemplates?: PrimaryFaceShapeTemplates;
};

/** Main entry: locate the best IS+BS+CF statement packet inside the filing. */
export function locatePrimaryStatementPacket(ctx: LocatorContext, opts: LocateOptions): LocatorResult {
  const form = opts.form.toUpperCase();
  const sectionHit = locateFinancialStatementsSection(ctx, form);
  if (!sectionHit) {
    return {
      section: { start: 0, end: ctx.acc.length },
      packet: null,
      packetAlternates: [],
      rejected: [],
      nearMisses: [{ kinds: {}, clusterScore: 0, span: 0, reason: "section_not_found" }],
      audit: { sectionStrategy: "none", blocksBuilt: 0, blocksScored: 0, packetsConsidered: 0 },
    };
  }

  const { section, strategy, scanCeiling } = sectionHit;
  const rawBlocks = buildStatementBlocks(ctx, section, scanCeiling);
  const scoredBlocks = scoreStatementBlocks(rawBlocks, section, form);
  const { packet, alternates, rejected, nearMisses } = findBestStatementPacket(scoredBlocks, section, form);
  const allPackets = [packet, ...alternates].filter((p): p is LocatedPacket => p != null);

  return {
    section,
    packet,
    packetAlternates: alternates,
    rejected,
    nearMisses,
    audit: {
      sectionStrategy: strategy,
      blocksBuilt: rawBlocks.length,
      blocksScored: scoredBlocks.length,
      packetsConsidered: allPackets.length,
    },
  };
}

export function getPrimaryTableFromBlock(packet: LocatedPacket, kind: "is" | "bs" | "cf") {
  const block = kind === "is" ? packet.is : kind === "bs" ? packet.bs : packet.cf;
  return block.tables[0] ?? null;
}
