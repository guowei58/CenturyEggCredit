/** Account allowed to apply manual risk-score overrides. */
export const RISK_CHECKLIST_OVERRIDE_ACCOUNT_EMAIL = "guowei58@hotmail.com";

/** Any signed-in user with an email may use Risk Checklist and PM Dashboard. */
export function canAccessRiskChecklist(email: string | null | undefined): boolean {
  return Boolean(email?.trim());
}

export function canApplyRiskManualOverride(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === RISK_CHECKLIST_OVERRIDE_ACCOUNT_EMAIL;
}
