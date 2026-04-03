import { describe, expect, it } from "vitest";

import {
  classifyResultType,
  inferAgencyFromUrl,
  isAllowedAgencyDomain,
} from "./classifier";

describe("classifier", () => {
  it("infers agency from official domains", () => {
    expect(inferAgencyFromUrl("https://www.fitchratings.com/entity/123")).toBe("Fitch");
    expect(inferAgencyFromUrl("https://www.moodys.com/research/foo")).toBe("Moody's");
    expect(inferAgencyFromUrl("https://www.spglobal.com/ratings/en/foo")).toBe("S&P");
  });

  it("isAllowedAgencyDomain rejects non-agency hosts", () => {
    expect(isAllowedAgencyDomain("www.fitchratings.com")).toBe(true);
    expect(isAllowedAgencyDomain("research.moodys.com")).toBe(true);
    expect(isAllowedAgencyDomain("ratings.spglobal.com")).toBe(true);
    expect(isAllowedAgencyDomain("google.com")).toBe(false);
    expect(isAllowedAgencyDomain("reuters.com")).toBe(false);
  });

  it("classifies rating actions", () => {
    expect(
      classifyResultType(
        "Corporate downgrade",
        "The rating was lowered to B+ from BB-",
        "https://www.fitchratings.com/foo"
      )
    ).toBe("rating_action");
  });

  it("classifies ABS / note pages", () => {
    expect(
      classifyResultType("ABS program update", "asset-backed securities term notes", "https://www.fitchratings.com/foo")
    ).toBe("issue_rating");
  });
});
