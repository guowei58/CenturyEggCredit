export type {
  BlockKindScore,
  FilingSectionBounds,
  LocatedPacket,
  LocatorAudit,
  LocatorContext,
  LocatorResult,
  NearMissPacket,
  RejectedCandidate,
  ScoredBlock,
  StatementBlock,
  StatementKind,
} from "./types";

export { buildStatementBlocks } from "./blocks";
export { findBestStatementPacket } from "./cluster";
export { locatePrimaryStatementPacket, getPrimaryTableFromBlock, type LocateOptions } from "./locate";
export { scoreStatementBlocks, pickBestBlockForKind } from "./score";
export { locateFinancialStatementsSection, extractHeadingBeforeOffset } from "./section";
export {
  POSITIVE_HEADINGS,
  POSITIVE_ROW_ANCHORS,
  NEGATIVE_CONTEXT_PATTERNS,
} from "./signals";
export { validateStatementPacket, type PacketValidation } from "./validate";
