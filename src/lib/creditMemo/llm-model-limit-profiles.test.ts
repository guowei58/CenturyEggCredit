import { describe, expect, it } from "vitest";

import { resolveModelLimits } from "@/lib/llm-model-limit-profiles";

describe("resolveModelLimits", () => {
  it("returns exact Claude Sonnet 4.6 numbers", () => {
    const r = resolveModelLimits("claude", "claude-sonnet-4-6");
    expect(r.match).toBe("exact");
    expect(r.contextWindow).toContain("1,000,000");
    expect(r.maxOutput).toContain("64,000");
  });

  it("returns exact DeepSeek chat max output 8,192", () => {
    const r = resolveModelLimits("deepseek", "deepseek-chat");
    expect(r.match).toBe("exact");
    expect(r.maxOutput).toContain("8,192");
  });

  it("marks custom ids as unlisted", () => {
    const r = resolveModelLimits("openai", "gpt-4o-custom-test");
    expect(r.match).toBe("unlisted");
  });

  it("treats empty as unset", () => {
    const r = resolveModelLimits("gemini", "");
    expect(r.match).toBe("unset");
  });
});
