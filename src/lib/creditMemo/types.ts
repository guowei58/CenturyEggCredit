import type { AiProvider } from "@/lib/ai-provider";

export type FolderCandidate = {
  path: string;
  folderName: string;
  score: number;
  matchType: string;
  reasons: string[];
  /** Ingest uses cloud workspace (Postgres); path is a sentinel string. */
  virtual?: "user_workspace";
};

export type FolderResolveResult =
  | {
      ok: true;
      rootSearched: string;
      chosen: FolderCandidate;
      alternates: FolderCandidate[];
    }
  | {
      ok: false;
      rootSearched: string;
      candidates: FolderCandidate[];
      error: string;
    };

export type SourceCategory =
  | "sec_filing"
  | "transcript"
  | "presentation"
  | "rating_agency"
  | "debt_document"
  | "model_spreadsheet"
  | "press_release"
  | "news"
  | "org_legal"
  | "notes"
  /** Sidebar AI Chat (drawer) merged at ingest — not from the research folder */
  | "ai_chat"
  | "other";

export type SourceFileRecord = {
  id: string;
  relPath: string;
  absPath: string;
  size: number;
  ext: string;
  category: SourceCategory;
  modifiedAt: string | null;
  parseStatus: "ok" | "partial" | "failed" | "skipped";
  charExtracted: number;
  parseNote?: string;
};

export type SourceChunkRecord = {
  id: string;
  sourceFileId: string;
  chunkIndex: number;
  text: string;
  sectionLabel: string | null;
};

export type ExtractedTableRecord = {
  id: string;
  sourceFileId: string;
  title: string;
  sheetName: string | null;
  previewText: string;
};

export type CreditMemoProject = {
  id: string;
  ticker: string;
  resolvedFolderPath: string;
  folderResolutionJson: unknown;
  status: "draft" | "ingested" | "error";
  createdAt: string;
  updatedAt: string;
  sources: SourceFileRecord[];
  chunks: SourceChunkRecord[];
  tables: ExtractedTableRecord[];
  ingestWarnings: string[];
};

export type MemoOutlineSection = {
  id: string;
  title: string;
  targetWords: number;
  emphasis: string;
};

export type MemoOutline = {
  /** Clamped total word budget for the memo (same as totalWordBudget). */
  targetWords: number;
  totalWordBudget: number;
  sections: MemoOutlineSection[];
  sourceNotes: string;
};

export type CreditMemoTemplate = {
  id: string;
  filename: string;
  uploadedAt: string;
  /** Titles from DOCX heading styles (H1/H2/H3) in order */
  headings: Array<{ level: 1 | 2 | 3; title: string }>;
  /** Flattened outline for memo planner */
  outlineTitles: string[];
};

export type CreditMemoTemplateIndex = {
  activeTemplateId: string | null;
  templates: CreditMemoTemplate[];
};

export type MemoJob = {
  id: string;
  projectId: string;
  ticker: string;
  targetWords: number;
  memoTitle: string;
  provider: AiProvider;
  status: "pending" | "running" | "completed" | "failed";
  outline: MemoOutline | null;
  markdown: string | null;
  /** Exact SOURCE PACK used to generate this job (may be trimmed to fit context). */
  sourcePack?: string | null;
  error: string | null;
  templateId?: string | null;
  templateFilename?: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};
