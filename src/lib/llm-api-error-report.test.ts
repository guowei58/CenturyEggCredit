import { describe, expect, it } from "vitest";
import { buildLlmApiErrorReport, formatLlmApiErrorDisplay } from "@/lib/llm-api-error-report";

describe("buildLlmApiErrorReport", () => {
  it("classifies Anthropic context overflow JSON", () => {
    const raw =
      '{"type":"error","error":{"type":"invalid_request_error","message":"prompt is too long: 201345 tokens > 200000 maximum"}}';
    const r = buildLlmApiErrorReport({ provider: "claude", httpStatus: 400, rawError: raw });
    expect(r.category).toBe("model_or_provider_limit");
    expect(r.title.toLowerCase()).toContain("context");
    expect(r.summary.toLowerCase()).toMatch(/not|oreo|model/);
  });

  it("classifies OpenAI context_length_exceeded", () => {
    const raw = JSON.stringify({
      error: {
        message: "This model's maximum context length is 128000 tokens. However, your messages resulted in 150000 tokens.",
        type: "invalid_request_error",
        code: "context_length_exceeded",
      },
    });
    const r = buildLlmApiErrorReport({ provider: "openai", httpStatus: 400, rawError: raw });
    expect(r.category).toBe("model_or_provider_limit");
  });

  it("classifies OpenAI insufficient_quota as billing", () => {
    const raw = JSON.stringify({
      error: { message: "You exceeded your current quota, please check your plan and billing details.", code: "insufficient_quota" },
    });
    const r = buildLlmApiErrorReport({ provider: "openai", httpStatus: 429, rawError: raw });
    expect(r.category).toBe("billing_or_quota");
  });

  it("classifies 429 rate limit without billing wording", () => {
    const r = buildLlmApiErrorReport({
      provider: "claude",
      httpStatus: 429,
      rawError: "Rate limit exceeded",
    });
    expect(r.category).toBe("rate_limit");
  });

  it("classifies invalid API key", () => {
    const r = buildLlmApiErrorReport({ provider: "openai", httpStatus: 401, rawError: "Invalid OpenAI API key" });
    expect(r.category).toBe("api_key");
  });

  it("classifies DeepSeek context message from our normalizer", () => {
    const r = buildLlmApiErrorReport({
      provider: "deepseek",
      httpStatus: 400,
      rawError: "DeepSeek context limit exceeded. Your saved data + conversation is too large for this model.",
    });
    expect(r.category).toBe("model_or_provider_limit");
  });

  it("classifies connection timeout", () => {
    const r = buildLlmApiErrorReport({
      provider: "claude",
      httpStatus: 504,
      rawError: "Claude request timed out waiting for the API",
    });
    expect(r.category).toBe("connection");
  });

  it("classifies missing key setup", () => {
    const r = buildLlmApiErrorReport({
      provider: "gemini",
      httpStatus: 503,
      rawError: "provider_not_configured",
    });
    expect(r.category).toBe("app_setup");
  });

  it("classifies DeepSeek text-only capability", () => {
    const r = buildLlmApiErrorReport({
      provider: "deepseek",
      httpStatus: 400,
      rawError: "DeepSeek in OREO is text-only. Switch to Claude or ChatGPT",
    });
    expect(r.category).toBe("model_or_provider_limit");
  });

  it("formatLlmApiErrorDisplay includes title and tips", () => {
    const r = buildLlmApiErrorReport({ provider: "openai", httpStatus: 429, rawError: "Rate limit exceeded" });
    const text = formatLlmApiErrorDisplay(r);
    expect(text).toContain(r.title);
    expect(text).toContain("What to try:");
  });
});
