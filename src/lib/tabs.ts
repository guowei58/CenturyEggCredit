/**
 * Tab ID derivation from tab labels. Single source of truth for URL-safe ids.
 */

import {
  companyAnalysisTabs,
  companyAnalysisWorkOutputTabs,
  companyAnalysisDesktopRisksTabs,
  companyAnalysisClaimsTabs,
  companyAnalysisFraudChecksTabs,
  pmDashboardTabs,
} from "@/data/mock";

export function tabLabelToId(label: string): string {
  return label
    .toLowerCase()
    .replace(/\s+&\s*/g, "-")
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
}

export const companyAnalysisTabIds = companyAnalysisTabs.map(tabLabelToId);
export const companyAnalysisWorkOutputTabIds = companyAnalysisWorkOutputTabs.map(tabLabelToId);
export const companyAnalysisDesktopRisksTabIds = companyAnalysisDesktopRisksTabs.map(tabLabelToId);
export const companyAnalysisClaimsTabIds = companyAnalysisClaimsTabs.map(tabLabelToId);
export const companyAnalysisFraudChecksTabIds = companyAnalysisFraudChecksTabs.map(tabLabelToId);
export const pmDashboardTabIds = pmDashboardTabs.map(tabLabelToId);

export type CompanyAnalysisTabId = (typeof companyAnalysisTabIds)[number];
export type PMDashboardTabId = (typeof pmDashboardTabIds)[number];

export function getCompanyAnalysisTabId(index: number): string {
  return companyAnalysisTabIds[index] ?? companyAnalysisTabIds[0];
}

export function getPMDashboardTabId(index: number): string {
  return pmDashboardTabIds[index] ?? pmDashboardTabIds[0];
}
