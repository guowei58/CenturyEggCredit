import { describe, expect, it } from "vitest";

import { CREDIT_MEMO_CHUNK_OVERLAP_CHARS } from "./chunkConstants";
import { joinIndexedTextSlicesWithoutOverlap, joinSourceChunksWithoutOverlap } from "./chunkStitch";
import type { SourceChunkRecord } from "./types";

function chunk(id: string, sourceFileId: string, chunkIndex: number, text: string): SourceChunkRecord {
  return { id, sourceFileId, chunkIndex, text, sectionLabel: null };
}

describe("joinSourceChunksWithoutOverlap", () => {
  it("stitches overlapping windows without repeating the shared prefix", () => {
    const overlap = "X".repeat(CREDIT_MEMO_CHUNK_OVERLAP_CHARS);
    const a = `HEAD-${overlap}`;
    const b = `${overlap}TAIL`;
    const joined = joinSourceChunksWithoutOverlap([
      chunk("c0", "s1", 0, a),
      chunk("c1", "s1", 1, b),
    ]);
    expect(joined).toBe(`HEAD-${overlap}TAIL`);
    expect(joined).not.toContain(`${overlap}${overlap}`);
  });

  it("sorts by chunk index before stitching", () => {
    const overlap = "ABCD";
    const joined = joinSourceChunksWithoutOverlap([
      chunk("c1", "s1", 1, `${overlap}two`),
      chunk("c0", "s1", 0, `one-${overlap}`),
    ]);
    expect(joined).toBe(`one-${overlap}two`);
  });

  it("does not merge non-consecutive chunk indices", () => {
    const joined = joinIndexedTextSlicesWithoutOverlap(
      [
        { chunkIndex: 0, text: "alpha-ABCD" },
        { chunkIndex: 2, text: "ABCD-beta" },
      ],
      4
    );
    expect(joined).toContain("alpha-ABCD");
    expect(joined).toContain("ABCD-beta");
    expect(joined).toContain("--- chunk ---");
  });
});
