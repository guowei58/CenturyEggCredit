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
