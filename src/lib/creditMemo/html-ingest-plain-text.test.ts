import { describe, expect, it } from "vitest";

import { htmlBufferToPlainTextForIngest } from "@/lib/html-ingest-plain-text";

describe("htmlBufferToPlainTextForIngest", () => {
  it("strips tags and prefers article text", () => {
    const html = `<!DOCTYPE html><html><body><nav>Nav</nav><article><p>Hello <b>world</b></p></article></body></html>`;
    const out = htmlBufferToPlainTextForIngest(Buffer.from(html, "utf8"));
    expect(out).toContain("Hello");
    expect(out).toContain("world");
    expect(out).not.toContain("<article>");
    expect(out).not.toContain("<b>");
  });

  it("removes script contents", () => {
    const html = `<html><body><script>alert(1)</script><p>OK</p></body></html>`;
    const out = htmlBufferToPlainTextForIngest(Buffer.from(html, "utf8"));
    expect(out).toContain("OK");
    expect(out).not.toMatch(/alert/);
  });
});
