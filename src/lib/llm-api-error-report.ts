import type { AiProvider } from "@/lib/ai-provider";

/** High-level buckets shown to users — OREO vs provider vs account vs network. */
export type LlmApiErrorCategory =
  | "model_or_provider_limit"
  | "connection"
  | "billing_or_quota"
  | "rate_limit"
  | "api_key"
  | "app_setup"
  | "provider_unavailable"
  | "unknown";

export type LlmApiErrorReport = {
  category: LlmApiErrorCategory;
  /** One-line headline for UI */
  title: string;
  /** Plain-language explanation (not an OREO bug when category says so) */
  summary: string;
  whatToTry: string[];
  provider: AiProvider | null;
  httpStatus?: number;
  /** Raw provider / server message for support debugging */
  detail?: string;
};

export function llmProviderDisplayName(provider: AiProvider | null | undefined): string {
  switch (provider) {
    case "claude":
      return "Claude (Anthropic)";
    case "openai":
      return "ChatGPT (OpenAI)";
    case "gemini":
      return "Gemini (Google)";
    case "deepseek":
      return "DeepSeek";
    default:
      return "The AI provider";
  }
}

type ParsedProviderError = {
  type?: string;
  code?: string;
  message: string;
};

function lower(s: string): string {
  return s.toLowerCase();
}

function extractProviderError(raw: string): ParsedProviderError {
  const trimmed = raw.trim();
  if (!trimmed) return { message: "" };
  try {
    const parsed = JSON.parse(trimmed) as {
      error?: { type?: string; message?: string; code?: string };
      type?: string;
      message?: string;
    };
    if (parsed?.error?.message) {
      return {
        type: parsed.error.type,
        code: parsed.error.code,
        message: parsed.error.message,
      };
    }
    if (typeof parsed.message === "string" && parsed.message.trim()) {
      return { type: parsed.type, message: parsed.message.trim() };
    }
  } catch {
    // not JSON — use raw text
  }
  return { message: trimmed };
}

function combinedHaystack(raw: string, parsed: ParsedProviderError): string {
  return lower([raw, parsed.message, parsed.type ?? "", parsed.code ?? ""].filter(Boolean).join(" "));
}

function isAppSetupMessage(hay: string): boolean {
  return (
    hay.includes("api key not configured for this account") ||
    hay.includes("provider_not_configured") ||
    hay.includes("sign in to") ||
    hay.includes("unauthorized") ||
    hay.includes("not configured for this account")
  );
}

function isApiKeyMessage(hay: string, status?: number): boolean {
  if (status === 401) return true;
  return (
    hay.includes("invalid api key") ||
    hay.includes("invalid openai api key") ||
    hay.includes("invalid deepseek api key") ||
    hay.includes("invalid or missing gemini api key") ||
    hay.includes("authentication") ||
    hay.includes("incorrect api key") ||
    hay.includes("permission denied") && hay.includes("api key")
  );
}

function isBillingOrQuotaMessage(hay: string, parsed: ParsedProviderError): boolean {
  const code = lower(parsed.code ?? "");
  const type = lower(parsed.type ?? "");
  if (code === "insufficient_quota" || type === "insufficient_quota") return true;
  return (
    hay.includes("insufficient_quota") ||
    hay.includes("insufficient balance") ||
    hay.includes("insufficient funds") ||
    hay.includes("billing") ||
    hay.includes("payment required") ||
    hay.includes("credit balance") ||
    hay.includes("exceeded your current quota") ||
    hay.includes("quota has been exceeded") && !hay.includes("rate limit") ||
    hay.includes("add funds") ||
    hay.includes("purchase credits")
  );
}

function isRateLimitMessage(hay: string, status?: number): boolean {
  if (status === 429) return true;
  return (
    hay.includes("rate limit") ||
    hay.includes("rate_limit") ||
    hay.includes("too many requests") ||
    hay.includes("resource exhausted") && !hay.includes("billing") ||
    hay.includes("rpm") ||
    hay.includes("tpm")
  );
}

function isContextWindowMessage(hay: string): boolean {
  return (
    hay.includes("context length") ||
    hay.includes("context window") ||
    hay.includes("maximum context") ||
    hay.includes("context_length_exceeded") ||
    hay.includes("prompt is too long") ||
    hay.includes("prompt too large") ||
    hay.includes("too many tokens") && (hay.includes("input") || hay.includes("request") || hay.includes("maximum")) ||
    hay.includes("token limit") && hay.includes("exceed") ||
    hay.includes("exceeds the context") ||
    hay.includes("maximum context length")
  );
}

function isOutputLimitMessage(hay: string): boolean {
  return (
    hay.includes("max_tokens") ||
    hay.includes("max_completion_tokens") ||
    hay.includes("output token") ||
    hay.includes("completion budget") ||
    hay.includes("finish_reason") && hay.includes("length") ||
    hay.includes("returned no visible text") ||
    hay.includes("empty response from openai") ||
    hay.includes("reasoning tokens") ||
    hay.includes("output token limit") ||
    hay.includes("max output")
  );
}

function isModelCapabilityMessage(hay: string): boolean {
  return (
    hay.includes("text-only") ||
    hay.includes("multimodal") ||
    hay.includes("does not accept temperature") ||
    hay.includes("model not found") ||
    hay.includes("does not exist") && hay.includes("model") ||
    hay.includes("openai refused") ||
    hay.includes("unsupported") && hay.includes("model") ||
    hay.includes("vision") && hay.includes("not support")
  );
}

function isOverloadMessage(hay: string, status?: number): boolean {
  if (status === 503) return true;
  return hay.includes("overloaded") || hay.includes("over capacity") || hay.includes("try again later");
}

function isConnectionMessage(hay: string, status?: number): boolean {
  if (status === 502 || status === 504) return true;
  return (
    hay.includes("network error") ||
    hay.includes("fetch failed") ||
    hay.includes("failed to fetch") ||
    hay.includes("econnreset") ||
    hay.includes("econnrefused") ||
    hay.includes("socket") ||
    hay.includes("timed out") ||
    hay.includes("timeout") ||
    hay.includes("headers timeout") ||
    hay.includes("client abort") ||
    hay.includes("bad gateway") ||
    hay.includes("gateway time-out") ||
    hay.includes("service unavailable")
  );
}

export function buildLlmApiErrorReport(params: {
  provider?: AiProvider | null;
  httpStatus?: number;
  rawError: string;
}): LlmApiErrorReport {
  const provider = params.provider ?? null;
  const httpStatus = params.httpStatus;
  const rawError = params.rawError.trim();
  const parsed = extractProviderError(rawError);
  const hay = combinedHaystack(rawError, parsed);
  const name = llmProviderDisplayName(provider);
  const detail = parsed.message || rawError || undefined;

  const base = { provider, httpStatus, detail: detail?.slice(0, 800) };

  if (!rawError && !httpStatus) {
    return {
      ...base,
      category: "unknown",
      title: "API request failed",
      summary: "The request failed without a detailed error from the provider.",
      whatToTry: ["Retry once.", "Switch to another provider or model in User Settings → API model."],
    };
  }

  if (isAppSetupMessage(hay) || rawError === "provider_not_configured") {
    return {
      ...base,
      category: "app_setup",
      title: "No API key configured in OREO",
      summary:
        "OREO could not call the model because your account has no API key saved for this provider (or you are not signed in). This is an account setup step — not a bug in your research data.",
      whatToTry: [
        "Open User Settings → API keys and add a key for this provider.",
        "Or use “Open in Claude / ChatGPT / Gemini / DeepSeek” on the tab and paste the answer manually (no API key needed).",
      ],
    };
  }

  if (isApiKeyMessage(hay, httpStatus)) {
    return {
      ...base,
      category: "api_key",
      title: "API key rejected by the provider",
      summary: `${name} rejected the API key OREO sent. OREO only forwards your saved key — it does not generate or validate keys itself.`,
      whatToTry: [
        "Confirm the key in User Settings → API keys is correct and active on the provider’s console.",
        "Regenerate the key on the provider site if it was revoked or copied incorrectly.",
      ],
    };
  }

  if (isBillingOrQuotaMessage(hay, parsed)) {
    return {
      ...base,
      category: "billing_or_quota",
      title: "Provider account billing or quota limit",
      summary: `${name} reported that your API account has insufficient quota or billing balance. OREO cannot charge or top up your provider account — this comes from the provider’s billing system.`,
      whatToTry: [
        "Check billing / usage on the provider’s console and add funds or raise limits if needed.",
        "Try a different provider (e.g. Gemini free tier) or a smaller/cheaper model.",
        "Wait if you hit a daily/monthly quota cap, then retry.",
      ],
    };
  }

  if (isRateLimitMessage(hay, httpStatus)) {
    return {
      ...base,
      category: "rate_limit",
      title: "Provider rate limit (too many requests)",
      summary: `${name} is throttling requests (requests-per-minute or tokens-per-minute). This is the provider’s traffic limit — not an OREO application error.`,
      whatToTry: [
        "Wait 1–3 minutes and retry.",
        "Avoid running several large API jobs at once on the same key.",
        "Use a higher tier on the provider console, or switch provider/model temporarily.",
      ],
    };
  }

  if (isContextWindowMessage(hay)) {
    return {
      ...base,
      category: "model_or_provider_limit",
      title: "Prompt too large for this model’s context window",
      summary: `Your prompt (plus system instructions and any attachments) exceeds what ${name} accepts in one request. OREO sent the request correctly — the model’s input limit is the constraint.`,
      whatToTry: [
        "Switch to a model with a larger context window (Claude Sonnet/Opus, GPT-4.1+, Gemini 2.5).",
        "Shorten the prompt, remove large pasted sections, or run on a tab with less bundled data.",
        "For DeepSeek, use Claude or Gemini for very long prompts.",
      ],
    };
  }

  if (isOutputLimitMessage(hay)) {
    return {
      ...base,
      category: "model_or_provider_limit",
      title: "Output limit reached for this model",
      summary: `${name} could not return a complete answer within the max output tokens for this model/run (some GPT-5 models also spend tokens on internal reasoning before visible text). OREO is not truncating the response — the provider stopped generation.`,
      whatToTry: [
        "Pick a model with a higher output cap, or lower reasoning effort for GPT-5-class models in User Settings.",
        "Ask for a shorter deliverable or split the task across multiple runs.",
        "For JSON/matrix jobs, try Claude or GPT-4o instead of DeepSeek (8k output cap).",
      ],
    };
  }

  if (isModelCapabilityMessage(hay)) {
    return {
      ...base,
      category: "model_or_provider_limit",
      title: "This model does not support what you asked for",
      summary: `${name} declined or cannot handle this request type (examples: images/PDFs on text-only models, unsupported parameters, or model id not available on your account). This is a provider/model capability mismatch — not an OREO data bug.`,
      whatToTry: [
        "Switch provider or model in the API model picker.",
        "For sample images in prompts, use Claude, ChatGPT, or Gemini — not DeepSeek.",
        "For PDF attachments in AI Chat, use Claude.",
      ],
    };
  }

  if (isOverloadMessage(hay, httpStatus)) {
    return {
      ...base,
      category: "provider_unavailable",
      title: `${name} is temporarily overloaded`,
      summary: "The provider’s servers are busy or unavailable right now. OREO reached the API, but the provider could not complete the job.",
      whatToTry: ["Wait 30–60 seconds and retry.", "Try another provider or a faster/smaller model."],
    };
  }

  if (isConnectionMessage(hay, httpStatus)) {
    return {
      ...base,
      category: "connection",
      title: "Connection or timeout reaching the provider",
      summary: `OREO could not get a timely response from ${name}. This is usually network latency, a very large prompt, or the provider taking longer than the HTTP timeout — not corrupted data in OREO.`,
      whatToTry: [
        "Retry once (large prompts often succeed on the second attempt).",
        "Check your internet connection and VPN/firewall rules.",
        "Try a smaller model or shorter prompt if timeouts repeat.",
      ],
    };
  }

  if (httpStatus && httpStatus >= 500) {
    return {
      ...base,
      category: "provider_unavailable",
      title: `${name} server error (HTTP ${httpStatus})`,
      summary: "The provider returned a server-side error. OREO forwarded your request; the failure happened on the provider’s infrastructure.",
      whatToTry: ["Retry in a minute.", "Check the provider’s status page.", "Try another model or provider."],
    };
  }

  if (httpStatus === 400 || httpStatus === 422) {
    return {
      ...base,
      category: "model_or_provider_limit",
      title: `${name} rejected the request`,
      summary:
        "The provider returned a bad-request error (invalid parameters, unsupported feature, or request shape this model rejects). This is between your chosen model and the prompt — not an OREO save-file issue.",
      whatToTry: [
        "Try another model in User Settings → API model.",
        "If the prompt includes images, switch away from DeepSeek.",
        "Retry with a shorter prompt.",
      ],
    };
  }

  const shortDetail = detail && detail.length <= 280 ? detail : undefined;
  return {
    ...base,
    category: "unknown",
    title: `${name} API request failed`,
    summary: shortDetail
      ? `The provider returned: “${shortDetail}”. OREO surfaces the provider’s message when possible — this is not necessarily an application bug.`
      : "The provider returned an error OREO could not classify further. See detail below if present.",
    whatToTry: [
      "Retry once.",
      "Switch provider or model.",
      "If it persists, compare the same prompt in the provider’s native chat app to see if the model itself fails.",
    ],
  };
}

export function formatLlmApiErrorDisplay(report: LlmApiErrorReport): string {
  const lines: string[] = [report.title, "", report.summary];
  if (report.whatToTry.length > 0) {
    lines.push("", "What to try:");
    for (const tip of report.whatToTry) {
      lines.push(`• ${tip}`);
    }
  }
  if (report.detail && report.detail.length > 280 && report.category === "unknown") {
    lines.push("", `Provider detail: ${report.detail.slice(0, 500)}${report.detail.length > 500 ? "…" : ""}`);
  }
  return lines.join("\n");
}

export function buildOutputTruncatedWarning(provider: AiProvider | null): string {
  const name = llmProviderDisplayName(provider);
  return (
    `${name} stopped because it hit the max output length for this run. ` +
    "The text below may be incomplete — not an OREO bug. " +
    "Try a model with a higher output cap, a shorter ask, or run again with a smaller scope."
  );
}

/** Build JSON body + HTTP status for Next.js routes. */
export function llmApiErrorResponseBody(params: {
  provider?: AiProvider | null;
  httpStatus?: number;
  rawError: string;
}): { status: number; body: { error: string; errorReport: LlmApiErrorReport } } {
  const report = buildLlmApiErrorReport(params);
  const status =
    params.httpStatus && params.httpStatus >= 400 && params.httpStatus < 600 ? params.httpStatus : 502;
  return {
    status,
    body: {
      error: formatLlmApiErrorDisplay(report),
      errorReport: report,
    },
  };
}
