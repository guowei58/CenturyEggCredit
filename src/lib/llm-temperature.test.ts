import { describe, expect, it } from "vitest";
import { modelAcceptsTemperature } from "@/lib/llm-temperature";
import { openAiChatCompletionsSearchModel } from "@/lib/openai";

describe("modelAcceptsTemperature", () => {
  it("skips OpenAI GPT-5, search, and o-series", () => {
    expect(modelAcceptsTemperature("openai", "gpt-5.4")).toBe(false);
    expect(modelAcceptsTemperature("openai", "gpt-5-search-api")).toBe(false);
    expect(modelAcceptsTemperature("openai", openAiChatCompletionsSearchModel("gpt-4o-mini"))).toBe(false);
    expect(modelAcceptsTemperature("openai", "o3-mini")).toBe(false);
    expect(modelAcceptsTemperature("openai", "gpt-4o-mini")).toBe(true);
  });

  it("skips DeepSeek reasoner only", () => {
    expect(modelAcceptsTemperature("deepseek", "deepseek-reasoner")).toBe(false);
    expect(modelAcceptsTemperature("deepseek", "deepseek-chat")).toBe(true);
  });

  it("allows Claude presets", () => {
    expect(modelAcceptsTemperature("claude", "claude-haiku-4-5-20251001")).toBe(true);
    expect(modelAcceptsTemperature("claude", "claude-opus-4-6")).toBe(true);
  });

  it("skips Gemini thinking/experimental ids", () => {
    expect(modelAcceptsTemperature("gemini", "gemini-2.5-flash")).toBe(true);
    expect(modelAcceptsTemperature("gemini", "gemini-2.5-flash-thinking")).toBe(false);
  });
});
