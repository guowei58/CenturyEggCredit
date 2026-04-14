import { describe, expect, it } from "vitest";

import { extractSectionHintsFromHtml } from "./templateStore";
import { buildTemplateDocxHintsBlock } from "./templatePromptBlocks";
import type { MemoOutline } from "./types";

describe("extractSectionHintsFromHtml", () => {
  it("maps body text under each heading to outline titles in order", () => {
    const html = `
      <p>Intro</p>
      <h2>Executive summary</h2><p>Discuss thesis here.</p>
      <h3>Risks</h3><p>List covenant and liquidity risks.</p>
    `;
    const titles = ["Executive summary", "Risks"];
    const hints = extractSectionHintsFromHtml(html, titles);
    expect(hints[0]).toContain("Discuss thesis");
    expect(hints[1]).toContain("covenant");
  });

  it("handles h4 headings", () => {
    const html = `<h4>Capital structure</h4><p>Debt stack overview.</p>`;
    const hints = extractSectionHintsFromHtml(html, ["Capital structure"]);
    expect(hints[0]).toContain("Debt stack");
  });
});

describe("buildTemplateDocxHintsBlock", () => {
  it("skips empty hints", () => {
    const outline: MemoOutline = {
      targetWords: 1000,
      totalWordBudget: 1000,
      sourceNotes: "",
      templateSectionHints: ["alpha", "", "beta"],
      sections: [
        { id: "a", title: "One", targetWords: 100, emphasis: "" },
        { id: "b", title: "Two", targetWords: 100, emphasis: "" },
        { id: "c", title: "Three", targetWords: 100, emphasis: "" },
      ],
    };
    const block = buildTemplateDocxHintsBlock(outline);
    expect(block).toContain("One");
    expect(block).toContain("alpha");
    expect(block).toContain("Three");
    expect(block).toContain("beta");
    expect(block).not.toContain("Two");
  });
});
