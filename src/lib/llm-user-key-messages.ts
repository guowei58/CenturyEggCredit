/** Shared copy for API errors and in-app UI (safe on client and server). */

/**
 * Explains why users supply their own keys, pricing expectations, the paste-into-chat alternative,
 * and quality variance. Use wherever the app asks for or requires LLM API keys.
 */
export const USER_LLM_API_KEYS_POLICY =
  "We are trying to keep this app as inexpensive to run as possible, so in-app cloud API features use your own API keys (saved under your login). " +
  "To generate work products from your research (memos, decks, and similar outputs), you need an API key: the system ingests your saved research and sends it to the model to build those deliverables. " +
  "A Google Gemini API key is free to create, but Google still limits usage (rate limits and quotas). Claude, ChatGPT, and DeepSeek APIs are pay-as-you-go: you create a key and add funds (or use provider billing) for what you use. " +
  "If you prefer not to deal with API keys, use “Open in Claude / ChatGPT / Gemini / DeepSeek in each tab, paste the prompt into that chat, then paste the answer into the workspace—no keys, but it takes more time. " +
  "The quality of results can vary a lot depending on which foundation model you use. " +
  "To add keys: User Settings (gear icon) → LLM API keys.";

/** Same text as {@link USER_LLM_API_KEYS_POLICY} (legacy name used across routes and components). */
export const USER_LLM_KEY_SETTINGS_HINT = USER_LLM_API_KEYS_POLICY;

/**
 * Short error for IR URL auto-suggest only. Full policy belongs in User Settings, not inline here.
 * Indexing (`/api/ir/index`) does not use an LLM; auto-suggest uses Claude + web search.
 */
export const IR_AUTOFIND_NEEDS_CLAUDE_KEY =
  "IR URL auto-suggest uses Claude web search and needs your Claude API key in User Settings. You can paste an IR URL and use Index page without keys.";
