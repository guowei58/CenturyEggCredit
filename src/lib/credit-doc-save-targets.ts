/** Saved-response keys for credit-doc workspace tabs and Analyze→API routing. */
export type CreditDocSavedBoxKey =
  | "credit-agreements-indentures-credit-agreement"
  | "credit-agreements-indentures-first-lien-indenture"
  | "credit-agreements-indentures-second-lien-indenture"
  | "credit-agreements-indentures-unsecured"
  | "credit-agreements-indentures-other-credit-documents"
  | "credit-agreements-indentures-convertible"
  | "credit-agreements-indentures-preferred"
  | "credit-agreements-indentures-other";

export const CREDIT_DOC_ANALYZE_SAVE_TARGETS: ReadonlyArray<{
  label: string;
  saveKey: CreditDocSavedBoxKey;
}> = [
  { label: "Credit Agreement", saveKey: "credit-agreements-indentures-credit-agreement" },
  { label: "First Lien Notes", saveKey: "credit-agreements-indentures-first-lien-indenture" },
  { label: "Second Lien Notes", saveKey: "credit-agreements-indentures-second-lien-indenture" },
  { label: "Unsecured Notes", saveKey: "credit-agreements-indentures-unsecured" },
  { label: "Other", saveKey: "credit-agreements-indentures-other-credit-documents" },
];

export function creditDocAnalyzeSaveTargetForKey(
  saveKey: CreditDocSavedBoxKey
): (typeof CREDIT_DOC_ANALYZE_SAVE_TARGETS)[number] {
  return (
    CREDIT_DOC_ANALYZE_SAVE_TARGETS.find((t) => t.saveKey === saveKey) ?? CREDIT_DOC_ANALYZE_SAVE_TARGETS[0]!
  );
}
