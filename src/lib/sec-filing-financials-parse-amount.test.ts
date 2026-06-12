import { describe, expect, it } from "vitest";
import {
  __test_composeRawAmount,
  __test_parseDisplayedNumber,
} from "@/lib/sec-filing-financials";

describe("sec-filing-financials amount parsing", () => {
  it("parses fully wrapped accounting negatives", () => {
    expect(__test_parseDisplayedNumber("(5,794)")).toBe(-5794);
    expect(__test_parseDisplayedNumber("$(5,794)")).toBe(-5794);
  });

  it("parses split-cell negatives missing closing paren (LUMN 2Q19)", () => {
    expect(__test_parseDisplayedNumber("$(5,794")).toBe(-5794);
    expect(__test_parseDisplayedNumber("(5,794")).toBe(-5794);
  });

  it("keeps positive amounts unchanged", () => {
    expect(__test_parseDisplayedNumber("407")).toBe(407);
    expect(__test_parseDisplayedNumber("$407")).toBe(407);
  });

  it("composeRawAmount closes $(number when paren is in the same cell", () => {
    expect(__test_composeRawAmount(["Net (loss) income", "$(5,794", ""], 1)).toBe("$(5,794)");
  });
});
