/** App-wide default and ceiling for completion / max output tokens (single place to tune). */
export const LLM_MAX_OUTPUT_TOKENS = 64_000;

/** DeepSeek Chat Completions API only allows max_tokens in [1, 8192] (provider-enforced). */
export const DEEPSEEK_MAX_OUTPUT_TOKENS = 8_192;
