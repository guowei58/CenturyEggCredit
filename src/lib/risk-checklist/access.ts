export const RISK_CHECKLIST_ACCOUNT_EMAIL = "guowei58@hotmail.com";

export function canAccessRiskChecklist(email: string | null | undefined): boolean {
  return email?.trim().toLowerCase() === RISK_CHECKLIST_ACCOUNT_EMAIL;
}

export function canApplyRiskManualOverride(email: string | null | undefined): boolean {
  return canAccessRiskChecklist(email);
}
