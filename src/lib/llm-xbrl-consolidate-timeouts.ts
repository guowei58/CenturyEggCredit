/**
 * SEC XBRL AI consolidation: one huge prompt + large max_tokens — needs long HTTP waits and a
 * matching Next.js route `maxDuration`.
 */

/** Next.js / Vercel `export const maxDuration` (seconds). */
export const XBRL_CONSOLIDATE_MAX_DURATION_SEC = 600;

/** Outbound LLM HTTP timeout (ms) for every provider on this route. */
export const XBRL_CONSOLIDATE_LLM_FETCH_TIMEOUT_MS = 600_000;
