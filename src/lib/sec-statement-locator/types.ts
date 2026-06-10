import type { Element } from "domhandler";

export type StatementKind = "is" | "bs" | "cf";

export type FilingSectionBounds = { start: number; end: number };

export type LocatedTable = { el: Element; offset: number; domIndex: number };

/** A visual statement block — may span one or more stitched adjacent HTML tables. */
export type StatementBlock = {
  id: string;
  tables: LocatedTable[];
  startOffset: number;
  endOffset: number;
  headingText: string;
  unitsText: string;
  periodHeaders: string[];
  rowLabels: string[];
  combinedText: string;
  ixTagCount: number;
  valueColumnCount: number;
  dataRowCount: number;
};

export type BlockKindScore = {
  kind: StatementKind;
  score: number;
  /** Normalized 0–1 confidence derived from score. */
  confidence: number;
  reasons: string[];
  penalties: string[];
};

export type ScoredBlock = StatementBlock & {
  kindScores: Record<StatementKind, BlockKindScore>;
  bestKind: StatementKind | null;
  bestScore: number;
};

export type LocatedPacket = {
  is: ScoredBlock;
  bs: ScoredBlock;
  cf: ScoredBlock;
  clusterScore: number;
  span: number;
  reasons: string[];
};

export type RejectedCandidate = {
  blockId: string;
  kind: StatementKind;
  score: number;
  reason: string;
};

export type NearMissPacket = {
  kinds: Partial<Record<StatementKind, string>>;
  clusterScore: number;
  span: number;
  reason: string;
};

export type LocatorAudit = {
  sectionStrategy: string;
  blocksBuilt: number;
  blocksScored: number;
  packetsConsidered: number;
};

export type LocatorResult = {
  section: FilingSectionBounds;
  packet: LocatedPacket | null;
  /** Additional ranked packets (10-Q IS fallbacks share BS/CF). */
  packetAlternates: LocatedPacket[];
  rejected: RejectedCandidate[];
  nearMisses: NearMissPacket[];
  audit: LocatorAudit;
};

export type LocatorContext = {
  $: import("cheerio").CheerioAPI;
  acc: string;
  tables: Array<{ el: Element; offset: number }>;
};
