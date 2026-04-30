import { describe, expect, it } from "vitest";
import { bodyContainsExhibit21Marker, bodyLooksLikeSubsidiarySchedule } from "@/lib/sec-filing-exhibits";

describe("bodyContainsExhibit21Marker", () => {
  it("accepts common Exhibit 21 headings", () => {
    expect(bodyContainsExhibit21Marker("<title>EX-21</title><p>List of subsidiaries")).toBe(true);
    expect(bodyContainsExhibit21Marker("EX-21.2\nSubsidiaries")).toBe(true);
    expect(bodyContainsExhibit21Marker("EX.21 \n foo")).toBe(true);
    expect(bodyContainsExhibit21Marker("EXHIBIT NO. 21\n")).toBe(true);
    expect(bodyContainsExhibit21Marker("(EX-21 LIST OF SUBSIDIARIES)")).toBe(true);
    expect(bodyContainsExhibit21Marker("<h1> Exhibit 21 — Subsidiaries</h1>")).toBe(true);
    expect(bodyContainsExhibit21Marker("EX21 Exhibit Office")).toBe(true);
  });

  it("rejects pages with no Exhibit 21 label", () => {
    const proxy = `Summary Compensation Table
    John Smith Grant of plan-based awards
    Non-qualified deferred compensation Delaware Inc. LLC Subsidiary Inc.`;
    expect(bodyContainsExhibit21Marker(proxy)).toBe(false);
  });

  it("does not match unrelated exhibit numbers", () => {
    expect(bodyContainsExhibit21Marker("See Exhibit 3.21 for subsidiary note")).toBe(false);
    expect(bodyContainsExhibit21Marker("Exhibit No. 7 — Consent")).toBe(false);
  });
});

describe("Exhibit 21 validation stack", () => {
  it("requires subsidiary schedule heuristics separately (integration of concerns)", () => {
    const onlyLabel = "EX-21\nnothing else here";
    expect(bodyContainsExhibit21Marker(onlyLabel)).toBe(true);
    expect(bodyLooksLikeSubsidiarySchedule(onlyLabel)).toBe(false);

    const subsidiaries = Array.from({ length: 35 }, (_, i) => `OpCo-${i}, Inc.`).join("\n");
    const labelAndRows = `EX-21\nLIST OF SUBSIDIARIES\n${subsidiaries}`;
    expect(bodyContainsExhibit21Marker(labelAndRows)).toBe(true);
    expect(bodyLooksLikeSubsidiarySchedule(labelAndRows)).toBe(true);
  });
});
