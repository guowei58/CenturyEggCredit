import { createHash } from "crypto";

import type { CreditMemoProject } from "./types";

/**
 * In-memory project used when running literary/biblical reference generation from a saved memo only
 * (no research folder ingested in this session). Same ticker; empty sources/chunks.
 */
export function memoOnlyReferenceStubProject(ticker: string): CreditMemoProject {
  const sym = ticker.trim().toUpperCase();
  const id = createHash("sha256").update(`memo-only-ref|${sym}`).digest("hex").slice(0, 22);
  const now = new Date().toISOString();
  return {
    id,
    ticker: sym,
    resolvedFolderPath: "",
    folderResolutionJson: { memoOnlyReferenceStub: true },
    status: "ingested",
    createdAt: now,
    updatedAt: now,
    sources: [],
    chunks: [],
    tables: [],
    ingestWarnings: [],
  };
}
