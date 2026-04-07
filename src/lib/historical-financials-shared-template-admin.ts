/**
 * Comma-separated NextAuth user ids allowed to replace the shared Historical Financials .xlsx template.
 * If unset or empty, shared template upload is disabled (download still works when a file exists).
 */
export function canUploadSharedHistoricalFinancialsTemplate(userId: string | undefined): boolean {
  if (!userId) return false;
  const raw = process.env.HISTORICAL_FINANCIALS_SHARED_TEMPLATE_ADMIN_USER_IDS?.trim();
  if (!raw) return false;
  const allowed = new Set(
    raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  );
  return allowed.has(userId);
}
