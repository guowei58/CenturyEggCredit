import { describe, expect, it } from "vitest";
import { makeDirectPairKey } from "./directPairKey";

describe("makeDirectPairKey", () => {
  it("is symmetric for the same two users", () => {
    const k1 = makeDirectPairKey("user_b", "user_a");
    const k2 = makeDirectPairKey("user_a", "user_b");
    expect(k1).toBe(k2);
    expect(k1).toBe("user_a::user_b");
  });

  it("throws when both ids are the same", () => {
    expect(() => makeDirectPairKey("x", "x")).toThrow();
  });
});
