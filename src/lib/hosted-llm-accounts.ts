/**
 * Accounts that use server-side LLM keys from environment variables.
 * All other signed-in users must store their own keys in User Settings.
 */

const HOSTED_LLM_EMAILS = new Set(
  ["guowei58@hotmail.com", "guowei58@gmail.com", "gzhang@centuryeggcredit.com"].map((e) => e.toLowerCase())
);

export function emailUsesHostedLlmKeys(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase();
  if (!e) return false;
  return HOSTED_LLM_EMAILS.has(e);
}
