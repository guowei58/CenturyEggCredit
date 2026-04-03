import path from "path";

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
    maxContextChars: parseIntEnv(process.env.CREDIT_MEMO_MAX_CONTEXT_CHARS, 280_000, 80_000, 900_000),
    maxOutputTokens: parseIntEnv(process.env.CREDIT_MEMO_MAX_OUTPUT_TOKENS, 16_000, 4_000, 64_000),
    maxFilesPerIngest: parseIntEnv(process.env.CREDIT_MEMO_MAX_FILES, 400, 20, 2000),
    maxIngestFileBytes: parseIntEnv(process.env.CREDIT_MEMO_MAX_FILE_BYTES, 18 * 1024 * 1024, 1024 * 1024, 80 * 1024 * 1024),
  };
}
