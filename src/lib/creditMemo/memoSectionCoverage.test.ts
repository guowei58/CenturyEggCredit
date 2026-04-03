import { describe, expect, it } from "vitest";

import {
  MEMO_SECTION_PLACEHOLDER,
  ensureAllOutlineSectionsInMarkdown,
  parseMarkdownH2Sections,
} from "./memoSectionCoverage";
import type { MemoOutline } from "./types";

function outlineFromTitles(titles: string[]): MemoOutline {
  return {
    targetWords: 5000,
    totalWordBudget: 5000,
    sections: titles.map((title, i) => ({
      id: `s${i}`,
      title,
      targetWords: 400,
      emphasis: "",
    })),
    sourceNotes: "",
  };
}

describe("parseMarkdownH2Sections", () => {
  it("splits preamble and ## sections", () => {
    const md = `# Memo\n\nIntro\n\n## One\n\nBody one.\n\n## Two\n\nBody two.`;
    const { preamble, sections } = parseMarkdownH2Sections(md);
    expect(preamble).toContain("Intro");
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("One");
    expect(sections[1].title).toBe("Two");
  });

  it("does not treat ### as H2", () => {
    const md = `## Main\n\n### Sub\n\nText`;
    const { sections } = parseMarkdownH2Sections(md);
    expect(sections).toHaveLength(1);
    expect(sections[0].body).toContain("### Sub");
  });
});

describe("ensureAllOutlineSectionsInMarkdown", () => {
  it("inserts missing sections with placeholder", () => {
    const md = `## A\n\nAlpha.`;
    const out = ensureAllOutlineSectionsInMarkdown(md, outlineFromTitles(["A", "B", "C"]));
    expect(out).toContain("## A");
    expect(out).toContain("Alpha.");
    expect(out).toContain("## B");
    expect(out).toContain("## C");
    expect(out.split(MEMO_SECTION_PLACEHOLDER).length).toBeGreaterThanOrEqual(3);
  });

  it("uses canonical outline title for heading", () => {
    const md = `## company overview\n\nX.`;
    const out = ensureAllOutlineSectionsInMarkdown(md, outlineFromTitles(["Company overview"]));
    expect(out).toMatch(/^## Company overview/m);
  });

  it("replaces empty body with placeholder", () => {
    const md = `## A\n\n## B\n\nBod`;
    const out = ensureAllOutlineSectionsInMarkdown(md, outlineFromTitles(["A", "B"]));
    expect(out).toContain(`## A\n\n${MEMO_SECTION_PLACEHOLDER}`);
  });
});
