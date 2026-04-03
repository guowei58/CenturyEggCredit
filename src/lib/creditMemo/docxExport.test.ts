import { describe, expect, it } from "vitest";

import { memoMarkdownToDocxBuffer } from "./docxExport";

describe("memoMarkdownToDocxBuffer", () => {
  it("returns a non-trivial docx buffer", async () => {
    const buf = await memoMarkdownToDocxBuffer(
      "## Executive summary\n\nParagraph one.\n\n- Bullet item\n",
      "TEST — Credit Memo"
    );
    expect(buf.length).toBeGreaterThan(2000);
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });
});
