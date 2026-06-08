/** Shared 429 / rate-limit backoff for OpenAI Chat Completions and Embeddings. */

export function openAiRateLimitMaxAttempts(): number {
  const raw = process.env.OPENAI_RATE_LIMIT_MAX_ATTEMPTS?.trim();
  if (!raw) return 4;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return 4;
  return Math.min(8, Math.max(1, n));
}

export function parseOpenAiRetryAfterMs(headers: Headers, attemptIndex: number): number {
  const ra = headers.get("retry-after")?.trim();
  if (ra) {
    const sec = Number.parseFloat(ra);
    if (Number.isFinite(sec) && sec > 0) {
      return Math.min(120_000, Math.max(5_000, Math.round(sec * 1000)));
    }
  }
  // 20s, 35s, 50s, … capped at 90s
  return Math.min(90_000, 20_000 + attemptIndex * 15_000);
}

export function isOpenAiRateLimitHttp(status: number, rawBody?: string): boolean {
  if (status === 429) return true;
  const m = (rawBody ?? "").toLowerCase();
  return m.includes("rate limit") || m.includes("rate_limit_exceeded");
}

export function openAiRateLimitUserMessage(context?: "chat" | "embeddings"): string {
  const phase =
    context === "embeddings"
      ? "embedding ranking for source retrieval"
      : context === "chat"
        ? "the analysis chat completion"
        : "OpenAI API calls";
  return (
    `OpenAI rate limit exceeded (RPM/TPM) during ${phase}. ` +
    `Forensic/LME/memo jobs use embeddings plus a large chat call on the same API key — a bulk tab update right before this often triggers 429 even on gpt-4o-mini. ` +
    `Wait 2–3 minutes and retry, or add a Gemini API key in Settings so embeddings can use Gemini and leave OpenAI quota for chat.`
  );
}

export async function sleepMs(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
