export type {
  PresentationCandidate,
  PresentationDiscoveryInput,
  PresentationDiscoveryMetadata,
  PresentationDiscoveryResult,
  PresentationFileType,
  PresentationReviewStatus,
  PresentationSourceType,
  PresentationValidationResult,
  RawPresentationLink,
  ValidatedPresentationCandidate,
} from "./types";

export {
  parseFiscalPeriodToken,
  roicPeriodToPresentationPeriod,
  resolveDiscoveryAnchorDate,
  inferPeriodFromText,
  periodsMatch,
} from "./period";

export {
  discoverManagementPresentation,
  resolveDiscoveryInputFromTicker,
} from "./orchestrator";

export { reviewStatusForConfidence, computeFinalConfidence, pickBestCandidate } from "./score";
export {
  companyNameMatchesText,
  classifyDocumentType,
  isTranscriptLikeDocument,
  prominentForeignTickerInTitle,
  tickerMatchesDocument,
} from "./validate";
