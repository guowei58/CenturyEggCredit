/** Long-file split for credit-memo ingest; must match `chunkText` / stitch logic. */
export const CREDIT_MEMO_CHUNK_MAX_CHARS = 12_000;
/** Overlap in characters between consecutive stored chunks; stitch drops this prefix on each chunk after the first. */
export const CREDIT_MEMO_CHUNK_OVERLAP_CHARS = 400;
