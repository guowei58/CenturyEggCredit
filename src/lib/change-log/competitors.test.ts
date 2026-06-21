import { describe, expect, it } from "vitest";
import {
  CHANGE_LOG_MAX_COMPETITORS,
  extractTickersFromCompetitorsText,
  mergeChangeLogCompetitorTickers,
  parseTickerList,
} from "./competitors";

describe("parseTickerList", () => {
  it("parses comma and newline separated tickers", () => {
    expect(parseTickerList("CRM, NOW\nWDAY")).toEqual(["CRM", "NOW", "WDAY"]);
  });

  it("skips invalid tokens", () => {
    expect(parseTickerList("CRM, private, N/A")).toEqual(["CRM"]);
  });
});

describe("extractTickersFromCompetitorsText", () => {
  it("reads Ticker column from markdown tables", () => {
    const text = `
| Rank | Competitor | Ticker | Type |
| --- | --- | --- | --- |
| 1 | Salesforce | CRM | Direct |
| 2 | ServiceNow | NOW | Adjacent |
`;
    expect(extractTickersFromCompetitorsText(text)).toEqual(["CRM", "NOW"]);
  });

  it("extracts parenthetical tickers", () => {
    expect(extractTickersFromCompetitorsText("Workday (WDAY) competes on HR software.")).toEqual([
      "WDAY",
    ]);
  });
});

describe("mergeChangeLogCompetitorTickers", () => {
  it("dedupes, excludes subject, and caps count", () => {
    const many = Array.from({ length: 10 }, (_, i) => `T${i}`);
    const merged = mergeChangeLogCompetitorTickers("MSFT", ["CRM", "CRM", "MSFT", ...many], ["NOW"]);
    expect(merged.map((c) => c.ticker)).toEqual(["CRM", "T0", "T1", "T2", "T3", "T4"]);
    expect(merged.length).toBe(CHANGE_LOG_MAX_COMPETITORS);
    expect(merged.find((c) => c.ticker === "NOW")).toBeUndefined();
  });

  it("prefers readthrus inputs before competitors tab", () => {
    const merged = mergeChangeLogCompetitorTickers("MSFT", ["CRM"], ["NOW"]);
    expect(merged[0]?.ticker).toBe("CRM");
    expect(merged[0]?.source).toBe("readthrus-inputs");
    expect(merged[1]?.ticker).toBe("NOW");
    expect(merged[1]?.source).toBe("competitors-tab");
  });
});
