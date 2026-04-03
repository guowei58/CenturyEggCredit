import path from "path";

/**
 * Extensions treated as directly readable plain-ish text (aligned with ticker-file-text-extract).
 * Used for evidence ordering so notes and research survive trimming ahead of binary office/PDF.
 */
export const TEXT_LIKE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".tsv",
  ".json",
  ".html",
  ".htm",
  ".xml",
  ".log",
  ".yaml",
  ".yml",
  ".css",
  ".scss",
  ".sql",
  ".sh",
  ".bat",
  ".ps1",
  ".ini",
  ".cfg",
  ".conf",
  ".properties",
  ".rtf",
  ".eml",
  ".ics",
  ".toml",
]);

export function isTextLikePath(relPath: string): boolean {
  return TEXT_LIKE_EXTENSIONS.has(path.extname(relPath).toLowerCase());
}
