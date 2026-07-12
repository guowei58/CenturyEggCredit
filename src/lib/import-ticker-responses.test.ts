import { describe, expect, it } from "vitest";
import { resolveTabResponseImportTarget } from "./import-ticker-responses";

describe("resolveTabResponseImportTarget", () => {
  it("matches numbered deliverable filenames with underscores", () => {
    const cases: Array<[string, string]> = [
      ["01_business-overview.txt", "Business Overview"],
      ["02_recent-events.txt", "Recent Events"],
      ["03_management-and-board.txt", "Management & Board"],
      ["04_business-model.txt", "Business Model"],
      ["05_howstuffworks.txt", "HowStuffWorks"],
      ["06_company-history.txt", "Company History"],
      ["07_capital-allocation.txt", "Capital Allocation"],
      ["08_credit-timeline.txt", "Credit Timeline"],
      ["09_out-of-the-box-ideas.txt", "Out-of-the-Box Ideas"],
      ["10_risk-from-10k.txt", "Risk from 10K"],
      ["11_business-risk-analysis.txt", "Business Risk Analysis"],
      ["12_porters-five-forces.txt", "Porter's Five Forces"],
      ["13_industry-history-and-drivers.txt", "Industry History and Drivers"],
      ["14_industry-value-chain.txt", "Industry Value Chain"],
      ["15_competitors.txt", "Competitors"],
    ];

    for (const [filename, tabLabel] of cases) {
      const target = resolveTabResponseImportTarget(filename);
      expect(target, filename).not.toBeNull();
      expect(target?.tabLabel, filename).toBe(tabLabel);
    }
  });

  it("matches tab label filenames and hyphenated numeric prefixes", () => {
    expect(resolveTabResponseImportTarget("Business Overview.txt")?.tabLabel).toBe("Business Overview");
    expect(resolveTabResponseImportTarget("03-management-and-board.txt")?.tabLabel).toBe("Management & Board");
  });
});
