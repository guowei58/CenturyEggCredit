import path from "path";

import { LLM_MAX_OUTPUT_TOKENS } from "@/lib/llm-output-tokens";

export type CreditMemoEnvConfig = {
  researchRootDir: string | null;
  maxContextChars: number;
  maxOutputTokens: number;
  maxFilesPerIngest: number;
  maxIngestFileBytes: number;
};

function parseIntEnv(v: string | undefined, fallback: number, min: number, max: number): number {
  if (!v?.trim()) return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/** Resolved absolute path, or null if unset */
export function getResearchRootResolved(): string | null {
  const raw = process.env.RESEARCH_ROOT_DIR?.trim();
  if (!raw) return null;
  return path.resolve(raw);
}

export function loadCreditMemoConfig(): CreditMemoEnvConfig {
  return {
    researchRootDir: getResearchRootResolved(),
    // No app-level evidence cap for now (CREDIT_MEMO_MAX_CONTEXT_CHARS ignored). Model/provider limits still apply.
    maxContextChars: Number.MAX_SAFE_INTEGER,
    maxOutputTokens: parseIntEnv(process.env.CREDIT_MEMO_MAX_OUTPUT_TOKENS, LLM_MAX_OUTPUT_TOKENS, 4_000, LLM_MAX_OUTPUT_TOKENS),
    maxFilesPerIngest: parseIntEnv(process.env.CREDIT_MEMO_MAX_FILES, 500_000, 20, 10_000_000),
    maxIngestFileBytes: parseIntEnv(
      process.env.CREDIT_MEMO_MAX_FILE_BYTES,
      4 * 1024 * 1024 * 1024,
      1024 * 1024,
      16 * 1024 * 1024 * 1024
    ),
  };
}
