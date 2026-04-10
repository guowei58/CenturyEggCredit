/** Shared copy for API errors and in-app UI (safe on client and server). */

/**
 * Explains why users supply their own keys, pricing expectations, the paste-into-chat alternative,
 * and quality variance. Use wherever the app asks for or requires LLM API keys.
 */
export const USER_LLM_API_KEYS_POLICY = `I am trying to keep this app free, so in-app cloud API features use your own API keys (saved under your login). To generate work products from your research (memos, decks, and similar outputs), you need an API key. The quality of results can vary a lot depending on which foundation model you use.

A Google Gemini API key is free to create, but Google limits usage severely (rate limits and quotas). Claude, ChatGPT, and DeepSeek APIs are pay-as-you-go: you create a key and add funds (use provider billing) for what you use. DeepSeek is the cheapest with each API call at around 0.5 cents, but its quality is poor and data is stale (and you're probably sending your credit analysis to the CCP). Claude Haiku is my personal favorite but expensive at 20-40x the cost of DeepSeek. Claude Opus 4.6 is over 100x the cost of DeepSeek.

If you are naturally cheap, use “Open in Claude / ChatGPT / Gemini / DeepSeek” in each tab, paste the prompt into that chat, then paste the answer into the workspace - no keys, but it takes more time. I personally like this method because the results are better and uses your personal history/preferences in your existing favorite Chat app, which is not the case if you use the API. However, in order to generate the memos and decks, you still need to use an API.`;

/** Same text as {@link USER_LLM_API_KEYS_POLICY} (legacy name used across routes and components). */
export const USER_LLM_KEY_SETTINGS_HINT = USER_LLM_API_KEYS_POLICY;

/**
 * Short error for IR URL auto-suggest only. Full policy belongs in User Settings, not inline here.
 * Indexing (`/api/ir/index`) does not use an LLM; auto-suggest uses Claude + web search.
 */
export const IR_AUTOFIND_NEEDS_CLAUDE_KEY =
  "IR URL auto-suggest uses Claude web search and needs your Claude API key in User Settings. You can paste an IR URL and use Index page without keys.";
