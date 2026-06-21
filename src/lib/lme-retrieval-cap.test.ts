import { describe, expect, it } from "vitest";

import { capLmeChunksPreservingEachDocument, type LmeIndexedChunk } from "@/lib/lme-retrieval";

function chunk(docId: string, idx: number): LmeIndexedChunk {
  return {
    id: `${docId}:${idx}`,
    docId,
    label: docId,
    chunkIndex: idx,
    chunkCount: 2,
    text: "x".repeat(100),
  };
}

describe("capLmeChunksPreservingEachDocument", () => {
  it("preserves at least one chunk per doc when over cap", () => {
    const chunks = [chunk("a", 0), chunk("a", 1), chunk("b", 0), chunk("b", 1), chunk("c", 0)];
    const { capped, corpusChunksWereCapped } = capLmeChunksPreservingEachDocument(chunks, 3);
    expect(corpusChunksWereCapped).toBe(true);
    expect(capped.length).toBe(3);
    const docs = new Set(capped.map((c) => c.docId));
    expect(docs).toEqual(new Set(["a", "b", "c"]));
  });
});
