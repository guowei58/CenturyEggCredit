import { describe, expect, it } from "vitest";

import { parseJsonObjectWithRepair } from "@/lib/entity-mapper-v2/repair-json";

describe("parseJsonObjectWithRepair", () => {
  it("parses valid JSON objects", () => {
    const out = parseJsonObjectWithRepair('{"evidence":[],"facility_matrices":[]}') as {
      evidence: unknown[];
    };
    expect(out.evidence).toEqual([]);
  });

  it("repairs truncated JSON objects", () => {
    const truncated = `\`\`\`json
{
  "evidence": [
    {"id":"ev-1","subsidiary_name":"Alpha Co","role":"Guarantor"},
    {"id":"ev-2","subsidiary_name":"Beta LLC","role":"Issuer"
\`\`\``;
    const out = parseJsonObjectWithRepair(truncated) as { evidence: unknown[] };
    expect(Array.isArray(out.evidence)).toBe(true);
    expect(out.evidence.length).toBeGreaterThanOrEqual(1);
  });
});
