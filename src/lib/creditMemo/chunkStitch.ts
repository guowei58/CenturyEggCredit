import { CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";
import type { SourceChunkRecord } from "./types";

export type IndexedTextSlice = { chunkIndex: number; text: string };

/**
 * Rejoin sliding-window slices without repeating overlap regions.
 * Only merges overlap when `chunkIndex` values are consecutive; non-adjacent picks stay separated.
 */
export function joinIndexedTextSlicesWithoutOverlap(
  slices: IndexedTextSlice[],
  overlapChars: number,
  nonAdjacentSeparator = "\n\n--- chunk ---\n\n"
): string {
  const sorted = [...slices].sort((a, b) => a.chunkIndex - b.chunkIndex);
  if (sorted.length === 0) return "";
  if (sorted.length === 1) return sorted[0]!.text;

  let out = sorted[0]!.text;
  for (let i = 1; i < sorted.length; i++) {
    const prevSlice = sorted[i - 1]!;
    const currSlice = sorted[i]!;
    if (currSlice.chunkIndex !== prevSlice.chunkIndex + 1) {
      out += nonAdjacentSeparator + currSlice.text;
      continue;
    }
    const prev = prevSlice.text;
    const curr = currSlice.text;
    let skip = 0;
    const maxProbe = Math.min(prev.length, curr.length, overlapChars + 512);
    for (let o = maxProbe; o >= 1; o--) {
      if (prev.slice(-o) === curr.slice(0, o)) {
        skip = o;
        break;
      }
    }
    if (skip > 0) {
      const tail = curr.slice(skip);
      if (tail) out += tail;
    } else {
      out += nonAdjacentSeparator + curr;
    }
  }
  return out;
}

/**
 * Rejoin ingest chunks into continuous source text without repeating overlap regions.
 * Ingest stores sliding windows (`CREDIT_MEMO_CHUNK_OVERLAP_CHARS`); naïve joins duplicate boundaries.
 */
export function joinSourceChunksWithoutOverlap(chunks: SourceChunkRecord[]): string {
  return joinIndexedTextSlicesWithoutOverlap(
    chunks.map((c) => ({ chunkIndex: c.chunkIndex, text: c.text })),
    CREDIT_MEMO_CHUNK_OVERLAP_CHARS
  );
}
