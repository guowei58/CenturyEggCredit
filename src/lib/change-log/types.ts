export const CHANGE_LOG_DATA_VERSION = 1 as const;

export const CHANGE_LOG_CATEGORIES = [
  "company",
  "filings",
  "earnings",
  "competitors",
  "products",
  "financing",
  "management",
  "industry",
  "regulatory",
  "other",
] as const;

export type ChangeLogCategory = (typeof CHANGE_LOG_CATEGORIES)[number];

export type ChangeLogEntryKind = "fact" | "analysis";

export type ChangeLogEntry = {
  id: string;
  /** Calendar date YYYY-MM-DD for grouping */
  date: string;
  headline: string;
  body: string;
  investmentRelevance?: string;
  kind: ChangeLogEntryKind;
  category: ChangeLogCategory;
  sourceName: string;
  sourceUrl: string;
  accessionNumber?: string;
  /** Stable dedupe key (normalized URL or accession) */
  dedupeKey: string;
};

export type ChangeLogDraft = {
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  startedAt: string;
  completedAt: string | null;
  status: "running" | "ready" | "failed";
  error?: string;
  entries: ChangeLogEntry[];
};

export type ChangeLogSavedUpdate = {
  id: string;
  periodStart: string;
  periodEnd: string;
  periodLabel: string;
  savedAt: string;
  savedByUserId: string;
  savedByUserEmail: string | null;
  savedByUserName: string | null;
  entries: ChangeLogEntry[];
};

export type ChangeLogStore = {
  v: typeof CHANGE_LOG_DATA_VERSION;
  lastChangeLogUpdatedAt: string | null;
  currentUpdateStartedAt: string | null;
  currentUpdateCompletedAt: string | null;
  draft: ChangeLogDraft | null;
  updates: ChangeLogSavedUpdate[];
};

export type ChangeLogSourceCandidate = {
  dedupeKey: string;
  date: string;
  title: string;
  summary: string | null;
  url: string;
  sourceName: string;
  sourceType: "news" | "sec" | "industry";
  accessionNumber?: string;
  form?: string;
  /** ISO timestamp used for strict in-window filtering (news/industry). */
  publishedAtIso?: string;
  /** Pre-built relevance line for SEC filings (deterministic draft). */
  investmentRelevance?: string;
  /** When set, this candidate is about a competitor of the subject company. */
  competitorTicker?: string;
};
