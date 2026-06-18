/** Shared copy for API errors and in-app UI (safe on client and server). */

/**
 * Explains why users supply their own keys, pricing expectations, the paste-into-chat alternative,
 * OREO vs foundation model, and quality variance. Use wherever the app asks for or requires LLM API keys.
 */
export const USER_LLM_API_KEYS_POLICY = `I am trying to keep this app free (or as free as possible). You can generate work products from your research (memos, decks, and similar outputs) in two ways.

1) Free (copy & paste): Use "Open in Claude / ChatGPT / Gemini / DeepSeek" in each tab, paste the prompt into that chat app, then paste the answer into the workspace — no keys required and no additional cost, but it takes more time and hassle. I personally like this method not only because it is free, but because the RESULTS ARE FAR BETTER than API calls to the same foundation model, and uses your own personal history/preferences in your existing favorite Chat app, which is not the case if you use the API.

2) API keys (faster, pay-as-you-go): Save a key under your login and use the in-app "Claude API", "ChatGPT API", "Gemini API", and "DeepSeek API" actions to run prompts without leaving OREO — much faster.  A Google Gemini API key is free to create, but Google limits usage severely (rate limits and quotas). Claude, ChatGPT, and DeepSeek APIs are pay-as-you-go: you create a key and add funds for what you use (try $5 to start). Frontier models get expensive quickly — DeepSeek is the cheapest with each API call at around half a penny, but its quality is dog doo doo and data is stale (and you're probably sending your credit analysis to the CCP). Claude Haiku 4.5 is my personal favorite but more expensive at 20-40x the cost of DeepSeek. Claude Opus 4.6 is over 100x the cost of DeepSeek. Play around and see what fits you. DON'T BLAME ME FOR YOU GETTING DOG DOO DOO ANSWERS FROM DOG DOO DOO MODELS. The OREO platform is just an organizational tool. The brain behind it is the foundation model that you decide to use.

One day very soon, we'll all run very good foundation models on our PCs for free, but until then, we remain under the tyranny of tokens.`;

/** Same text as {@link USER_LLM_API_KEYS_POLICY} (legacy name used across routes and components). */
export const USER_LLM_KEY_SETTINGS_HINT = USER_LLM_API_KEYS_POLICY;

