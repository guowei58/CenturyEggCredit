/**
 * Consumer chat UIs (chat.deepseek.com, ChatGPT, Claude, etc.) inject the current date/time into the model
 * context. Raw provider APIs do not, so models often treat "today" as their training cutoff (e.g. mid-2024).
 * Prepend this to system prompts so API completions align with those UIs for timelines, filing recency, and "as of".
 */
export function augmentLlmSystemPromptWithCurrentTime(systemPrompt: string): string {
  const now = new Date();
  const iso = now.toISOString();
  const calendarUtc = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
    timeZoneName: "short",
  }).format(now);

  const prefix = `Current date and time (treat as authoritative "today" for timelines, filing dates, and recency unless the user specifies another reference date): ${iso} — ${calendarUtc}.

`;

  return `${prefix}${systemPrompt ?? ""}`;
}

const LLM_VERIFICATION_SUFFIX = `

Accuracy and self-check (required):
- Before you finish, re-read your answer for factual claims (names, dates, numbers, legal/SEC details, leadership, transactions). Make them consistent with the user's prompt, any attached context, and the current date/time at the start of this system message.
- Separate what is directly supported by supplied text from inference or general knowledge. When uncertain or time-sensitive, say so briefly.
- If a web_search tool is available in this API session, use it to verify or refresh recent facts (filings, corporate actions, ratings, "latest" events) before your final answer; briefly note what you verified when it matters.
- If no search tool is available (typical for DeepSeek/OpenAI/Gemini API unless the host adds one), do not claim you browsed the web. Give your best answer and, for critical time-sensitive items, add a short "verify" line with concrete sources (e.g. SEC EDGAR, company IR, rating agency).
`;

/** Prepends current time and appends rigor / verification instructions for all cloud API completions. */
export function augmentLlmFullSystemPrompt(systemPrompt: string): string {
  return `${augmentLlmSystemPromptWithCurrentTime(systemPrompt)}${LLM_VERIFICATION_SUFFIX}`;
}
