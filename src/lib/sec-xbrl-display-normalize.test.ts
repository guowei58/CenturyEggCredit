import { describe, expect, it } from "vitest";



import { isNegatedPreferredLabel, normalizeXbrlFactForStatementModel } from "@/lib/sec-xbrl-display-normalize";



describe("normalizeXbrlFactForStatementModel", () => {

  it("applies negated preferred label on income statement", () => {

    const r = normalizeXbrlFactForStatementModel({

      kind: "is",

      concept: "us-gaap:RevenueFromContractWithCustomerExcludingAssessedTax",

      label: "Revenue",

      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedLabel",

      raw: 100,

    });

    expect(r.display).toBe(-100);

    expect(r.rule).toContain("sec_negated_label");

  });



  it("cash flow: net other-financing line keeps instance sign (avoids double-flip on payments)", () => {

    const r = normalizeXbrlFactForStatementModel({

      kind: "cf",

      concept: "us-gaap:ProceedsFromPaymentsForOtherFinancingActivities",

      label: "Proceeds from (Payments for) Other Financing Activities",

      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedLabel",

      raw: -1.311e6,

    });

    expect(r.display).toBe(-1.311e6);

    expect(r.rule).toBe("cf_instance_signed_net_line");

  });



  it("cash flow: negated label inverts positive instance", () => {

    const r = normalizeXbrlFactForStatementModel({

      kind: "cf",

      concept: "us-gaap:SomeFinancingLine",

      label: "Financing",

      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedLabel",

      raw: 2e6,

    });

    expect(r.display).toBe(-2e6);

    expect(r.rule).toBe("cf_negated_label");

  });



  it("cash flow: negatedTerseLabel + negative MarketableSecuritiesGainLoss* matches printed 10-Q gain", () => {

    const r = normalizeXbrlFactForStatementModel({

      kind: "cf",

      concept: "us-gaap:MarketableSecuritiesGainLossExcludingOtherThanTemporaryImpairments",

      label: "Marketable Security, Gain (Loss)",

      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedTerseLabel",

      raw: -3.174e6,

    });

    expect(r.display).toBe(3.174e6);

    expect(r.rule).toBe("cf_negated_label");

  });



  it("cash flow: GainLossOnSaleOfPP&E-style line with negatedTerseLabel + negative raw matches face", () => {

    const r = normalizeXbrlFactForStatementModel({

      kind: "cf",

      concept: "us-gaap:GainLossOnSaleOfPropertyPlantEquipment",

      label: "Gain (Loss) on Disposition of Property Plant Equipment",

      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedTerseLabel",

      raw: -70_000,

    });

    expect(r.display).toBe(70_000);

    expect(r.rule).toBe("cf_negated_label");

  });



  it("cash flow: payment lines with positive instance magnitude show as outflow", () => {
    expect(
      normalizeXbrlFactForStatementModel({
        kind: "cf",
        concept: "us-gaap:FinanceLeasePrincipalPayments",
        label: "Finance Lease, Principal Payments",
        preferredLabelRole: null,
        raw: 1.311e6,
      }).display
    ).toBe(-1.311e6);
    expect(
      normalizeXbrlFactForStatementModel({
        kind: "cf",
        concept: "us-gaap:PaymentsOfDebtIssuanceCosts",
        label: "Payments of Debt Issuance Costs",
        preferredLabelRole: null,
        raw: 706_000,
      }).display
    ).toBe(-706_000);
  });

  it("cash flow: payment lines keep negative instance as outflow", () => {
    const r = normalizeXbrlFactForStatementModel({
      kind: "cf",
      concept: "us-gaap:PaymentsOfDebtIssuanceCosts",
      label: "Payments",
      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedLabel",
      raw: -706_000,
    });
    expect(r.display).toBe(-706_000);
    expect(r.rule).toBe("cf_payment_outflow_magnitude");
  });

  it("cash flow: product-line / extension asset-sale gains show as subtracted (negative display)", () => {
    const r = normalizeXbrlFactForStatementModel({
      kind: "cf",
      concept: "fico:GainLossOnProductLineAssetSale",
      label: "Gain (Loss) On Product Line Asset Sale",
      preferredLabelRole: "http://www.xbrl.org/2003/role/terseLabel",
      raw: 1.941e6,
    });
    expect(r.display).toBe(-1.941e6);
    expect(r.rule).toBe("cf_indirect_noncash_gain_sign");
  });

  it("cash flow: marketable securities Gain (Loss) keeps negated-label face sign", () => {
    const r = normalizeXbrlFactForStatementModel({
      kind: "cf",
      concept: "us-gaap:MarketableSecuritiesGainLossExcludingOtherThanTemporaryImpairments",
      label: "Marketable Security, Gain (Loss)",
      preferredLabelRole: "http://www.xbrl.org/2009/role/negatedTerseLabel",
      raw: 3.854e6,
    });
    expect(r.display).toBe(-3.854e6);
    expect(r.rule).toBe("cf_negated_label");
  });

  it("cash flow: PP&E Gain (Loss) on disposition keeps face sign", () => {
    const r = normalizeXbrlFactForStatementModel({
      kind: "cf",
      concept: "us-gaap:GainLossOnSaleOfPropertyPlantEquipment",
      label: "Gain (Loss) on Disposition of Property Plant Equipment",
      preferredLabelRole: null,
      raw: 0.555e6,
    });
    expect(r.display).toBe(0.555e6);
    expect(r.rule).toBe("cf_instance_signed");
  });

});



describe("sec-xbrl-as-presented-scale (EPS not ÷1M)", () => {

  it("detects EPS concepts", async () => {

    const { isSecXbrlPerShareRowConcept, formatSecXAsPresentedCell } = await import(

      "@/lib/sec-xbrl-as-presented-scale",

    );

    expect(isSecXbrlPerShareRowConcept("us-gaap:EarningsPerShareBasic")).toBe(true);

    expect(isSecXbrlPerShareRowConcept("us-gaap:EarningsPerShareDiluted")).toBe(true);

    expect(isSecXbrlPerShareRowConcept("us-gaap:Revenues")).toBe(false);

    expect(formatSecXAsPresentedCell("us-gaap:EarningsPerShareDiluted", 3.42)).not.toContain("M");

    expect(formatSecXAsPresentedCell("us-gaap:Revenues", 3.42e6)).toContain("M");
    expect(formatSecXAsPresentedCell("us-gaap:Revenues", 3.42e6)).toContain("$");

    const wavgBasic = formatSecXAsPresentedCell("us-gaap:WeightedAverageNumberOfSharesOutstandingBasic", 24.38e6);
    expect(wavgBasic).not.toContain("$");
    expect(wavgBasic.endsWith("M")).toBe(true);

    const wavgDil = formatSecXAsPresentedCell("us-gaap:WeightedAverageNumberDilutedSharesOutstanding", 24.76e6);
    expect(wavgDil).not.toContain("$");
    expect(wavgDil.endsWith("M")).toBe(true);

  });

});

describe("isNegatedPreferredLabel", () => {

  it("detects 2009 negatedLabel role", () => {

    expect(isNegatedPreferredLabel("http://www.xbrl.org/2009/role/negatedLabel")).toBe(true);

  });

});

