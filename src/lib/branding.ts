export const PRODUCT_NAME = "Century Egg Credit";

/**
 * SEC and many public sites rate-limit anonymous/empty User-Agents.
 * Provide a stable product UA string with a small context suffix.
 */
export function oreoUserAgent(context?: string): string {
  const base = `${PRODUCT_NAME} (research prototype)`;
  const ctx = (context || "").trim();
  return ctx ? `${base} - ${ctx}` : base;
}

