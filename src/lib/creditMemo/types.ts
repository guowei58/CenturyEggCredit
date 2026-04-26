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

/** Remove ingested corpus from a project; keeps id/ticker/paths for UI. Work products live in saved-data / workspace. */
export function stripCorpusFromProject(project: CreditMemoProject): CreditMemoProject {
  return {
    ...project,
    sources: [],
    chunks: [],
    tables: [],
    ingestWarnings: [],
    updatedAt: new Date().toISOString(),
  };
}

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
  /** When the outline came from a DOCX template: text excerpt under each heading (same order as `sections`). */
  templateSectionHints?: string[];
};

export type CreditMemoTemplate = {
  id: string;
  filename: string;
  uploadedAt: string;
  /** Titles from DOCX heading styles (H1–H6) in document order */
  headings: Array<{ level: 1 | 2 | 3 | 4 | 5 | 6; title: string }>;
  /** Flattened outline for memo planner */
  outlineTitles: string[];
  /** Plain text under each outline heading in the template (same order as `outlineTitles`); optional for templates saved before this field existed */
  sectionHints?: string[];
  /** Shipped default outline (same file for all users); not stored in user workspace */
  isPublicDefault?: boolean;
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
