import { describe, expect, it } from "vitest";

import { capMemoChunksPreservingEachSource } from "@/lib/creditMemo/kpiRetrieval";
import type { SourceChunkRecord } from "@/lib/creditMemo/types";

function chunk(id: string, sourceFileId: string, chunkIndex: number): SourceChunkRecord {
  return {
    id,
    sourceFileId,
    chunkIndex,
    text: `text-${id}`,
  };
}

describe("capMemoChunksPreservingEachSource", () => {
  it("returns all chunks when under cap", () => {
    const chunks = [chunk("a1", "s1", 0), chunk("a2", "s1", 1), chunk("b1", "s2", 0)];
    const { capped, corpusChunksWereCapped } = capMemoChunksPreservingEachSource(chunks, 10);
    expect(corpusChunksWereCapped).toBe(false);
    expect(capped).toHaveLength(3);
  });

  it("keeps at least one chunk per source when over cap", () => {
    const chunks = [
      chunk("a1", "s1", 0),
      chunk("a2", "s1", 1),
      chunk("b1", "s2", 0),
      chunk("b2", "s2", 1),
      chunk("c1", "s3", 0),
    ];
    const { capped, corpusChunksWereCapped } = capMemoChunksPreservingEachSource(chunks, 3);
    expect(corpusChunksWereCapped).toBe(true);
    expect(capped).toHaveLength(3);
    expect(capped.map((c) => c.sourceFileId).sort()).toEqual(["s1", "s2", "s3"]);
    expect(capped.find((c) => c.sourceFileId === "s1")?.chunkIndex).toBe(0);
  });
});
