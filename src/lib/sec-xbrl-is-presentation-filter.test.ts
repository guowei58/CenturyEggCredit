import { describe, expect, it } from "vitest";

import { isFinancialServicesFromInstanceXml } from "@/lib/sec-xbrl-instance-financial-sector";
import { shouldSuppressNonFinancialIncomeRow } from "@/lib/sec-xbrl-is-presentation-filter";

describe("isFinancialServicesFromInstanceXml", () => {
  it("is true for SIC in financial range (e.g. national commercial bank)", () => {
    const xml = `<?xml version="1.0"?><xbrl xmlns:dei="http://xbrl.sec.gov/dei/2023">
      <dei:StandardIndustrialClassification contextRef="c0">6021</dei:StandardIndustrialClassification>
    </xbrl>`;
    expect(isFinancialServicesFromInstanceXml(xml)).toBe(true);
  });

  it("is false for typical tech SIC", () => {
    const xml = `<dei:StandardIndustrialClassification>7372</dei:StandardIndustrialClassification>`;
    expect(isFinancialServicesFromInstanceXml(xml)).toBe(false);
  });

  it("is true for NAICS 522110 in industry text", () => {
    const xml = `<dei:EntityIndustryClassification contextRef="c0">522110 Commercial Banking</dei:EntityIndustryClassification>`;
    expect(isFinancialServicesFromInstanceXml(xml)).toBe(true);
  });
});

describe("shouldSuppressNonFinancialIncomeRow", () => {
  it("keeps net income and pretax bridge lines", () => {
    expect(shouldSuppressNonFinancialIncomeRow("us-gaap:NetIncomeLoss", "Net income")).toBe(false);
    expect(
      shouldSuppressNonFinancialIncomeRow(
        "us-gaap:IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest",
        "Pretax"
      )
    ).toBe(false);
  });

  it("drops continuing operations net line", () => {
    expect(
      shouldSuppressNonFinancialIncomeRow("us-gaap:IncomeLossFromContinuingOperations", "Income from continuing operations")
    ).toBe(true);
  });

  it("drops profit loss from continuing operations", () => {
    expect(
      shouldSuppressNonFinancialIncomeRow("us-gaap:ProfitLossFromContinuingOperations", "Continuing operations")
    ).toBe(true);
  });

  it("drops discontinued operations", () => {
    expect(
      shouldSuppressNonFinancialIncomeRow(
        "us-gaap:IncomeLossFromDiscontinuedOperationsNetOfTaxAttributableNoncontrollingInterest",
        "Discontinued"
      )
    ).toBe(true);
  });

  it("keeps disposal gain/loss tagged NotDiscontinued (continuing ops), e.g. LUMN FY22", () => {
    expect(
      shouldSuppressNonFinancialIncomeRow(
        "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal",
        "Loss on disposal groups held for sale"
      )
    ).toBe(false);
  });

  it("keeps same concept when GAAP documentation label mentions Not Discontinued Operation", () => {
    expect(
      shouldSuppressNonFinancialIncomeRow(
        "us-gaap:DisposalGroupNotDiscontinuedOperationGainLossOnDisposal",
        "Disposal Group, Not Discontinued Operation, Gain (Loss) on Disposal"
      )
    ).toBe(false);
  });

  it("drops OCI and comprehensive income concepts", () => {
    expect(shouldSuppressNonFinancialIncomeRow("us-gaap:OtherComprehensiveIncomeLossNetOfTaxPortionAttributableToParent", "OCI")).toBe(
      true
    );
    expect(
      shouldSuppressNonFinancialIncomeRow(
        "us-gaap:ComprehensiveIncomeNetOfTaxAttributableToParent",
        "Comprehensive income"
      )
    ).toBe(true);
  });
});
