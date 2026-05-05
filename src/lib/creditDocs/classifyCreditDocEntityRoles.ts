import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";
import type { CreditDocExtractionConfidence } from "@/generated/prisma/client";

/** Map deterministic role label substring → enum (signature / schedule headings). */
const LABEL_TO_ROLE: { re: RegExp; role: CreditDocWorkflowEntityRole; conf: CreditDocExtractionConfidence }[] = [
  { re: /\bco[-\s]?issuer\b/i, role: "co_issuer", conf: "high" },
  { re: /\bborrower\b/i, role: "borrower", conf: "high" },
  { re: /\bguarantor\b/i, role: "guarantor", conf: "high" },
  { re: /\bsubsidiary\s+guarantor\b/i, role: "subsidiary_guarantor", conf: "high" },
  { re: /\bparent\s+guarantor\b/i, role: "parent_guarantor", conf: "high" },
  { re: /\bgrantor\b/i, role: "grantor", conf: "high" },
  { re: /\bpledgor\b/i, role: "pledgor", conf: "high" },
  { re: /\bloan\s+party\b/i, role: "loan_party", conf: "high" },
  { re: /\bobligor\b/i, role: "obligor", conf: "medium" },
  { re: /\bissuer\b/i, role: "issuer", conf: "high" },
  { re: /\brestricted\s+subsidiar/i, role: "restricted_subsidiary", conf: "high" },
  { re: /\bunrestricted\s+subsidiar/i, role: "unrestricted_subsidiary", conf: "high" },
  { re: /\bexcluded\s+subsidiar/i, role: "excluded_subsidiary", conf: "high" },
  { re: /\bimmaterial\s+subsidiar/i, role: "immaterial_subsidiary", conf: "medium" },
  { re: /\bnon[- ]?guarantor\s+subsidiar/i, role: "non_guarantor_subsidiary", conf: "high" },
  { re: /\brestricted\s+non[- ]?guarantor/i, role: "restricted_non_guarantor_subsidiary", conf: "high" },
  { re: /\breceivables\s+subsidiar/i, role: "receivables_subsidiary", conf: "high" },
  { re: /\bsecuritization\s+subsidiar/i, role: "securitization_subsidiary", conf: "high" },
  { re: /\bfinance\s+subsidiar/i, role: "finance_subsidiary", conf: "high" },
];

export function classifyRoleFromSignatureContext(context: string): {
  role: CreditDocWorkflowEntityRole;
  confidence: CreditDocExtractionConfidence;
} {
  const t = context.replace(/\s+/g, " ").trim();
  for (const row of LABEL_TO_ROLE) {
    if (row.re.test(t)) return { role: row.role, confidence: row.conf };
  }
  return { role: "unknown", confidence: "low" };
}

export function classifyRoleFromScheduleTitle(title: string): {
  role: CreditDocWorkflowEntityRole | null;
  confidence: CreditDocExtractionConfidence;
} {
  const tl = title.toLowerCase();
  const pairs: [RegExp, CreditDocWorkflowEntityRole, CreditDocExtractionConfidence][] = [
    [/guarantor/i, "guarantor", "high"],
    [/borrower/i, "borrower", "high"],
    [/grantor/i, "grantor", "high"],
    [/pledgor/i, "pledgor", "high"],
    [/restricted\s+subsidi/i, "restricted_subsidiary", "high"],
    [/unrestricted\s+subsidi/i, "unrestricted_subsidiary", "high"],
    [/loan\s+part/i, "loan_party", "high"],
  ];
  for (const [re, role, conf] of pairs) {
    if (re.test(tl)) return { role, confidence: conf };
  }
  return { role: null, confidence: "low" };
}
