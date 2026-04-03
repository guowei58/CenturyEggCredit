export const SUPPLIERS_PROMPT_TEMPLATE = `You are a meticulous equity / credit research assistant.

I will provide a company ticker and, if helpful, the company name.

Your task is to build a deep, practical profile of the company’s supplier base and procurement dependencies.

Target company:
TICKER: [INSERT TICKER]
COMPANY NAME: [INSERT COMPANY NAME]

OBJECTIVE
I want to understand who the company’s suppliers are, what the company buys from them, how important they are, how procurement works, how much leverage the suppliers have, what substitutes exist, and what this implies for margins, operational resilience, bargaining power, supply risk, and forecasting.

Please first determine whether the company is primarily:
1. product / manufacturing driven
2. service / labor driven
3. digital / software / infrastructure driven
4. asset / commodity driven
5. mixed

Then tailor the analysis accordingly.

GENERAL INSTRUCTIONS
- Be specific, not generic.
- Use source-backed reasoning wherever possible.
- Ground the analysis in the company’s actual business model, cost structure, operating footprint, and industry.
- Use primary sources first whenever possible:
  - 10-K
  - 10-Q
  - annual report
  - investor presentations
  - earnings call transcripts
  - management conference presentations
  - company website
  - proxy
  - major contracts or supply agreements if disclosed
- Then use reputable secondary sources where helpful:
  - trade press
  - industry reports
  - competitor disclosures
  - supplier disclosures
  - customs / shipping data if credible
  - regulatory filings
- Distinguish clearly between:
  - facts supported by sources
  - reasonable inferences
  - open questions / information gaps
- Do not just repeat management language. Interpret what it means.
- Focus on economic dependence, bargaining power, switching difficulty, and cost structure implications.

OUTPUT FORMAT

Start with:
A. Executive summary
Give me a concise summary of:
- who the company’s key suppliers are
- what the company depends on them for
- how concentrated or fragmented the supplier base appears to be
- how much bargaining power suppliers seem to have
- what alternatives or substitute suppliers exist
- what this says about gross margin, operating risk, resilience, and pricing power

Then provide the following sections:

1. Supplier overview
Describe the supplier base at a high level:
- what the company buys
- whether inputs are physical goods, labor, logistics, software, network access, manufacturing services, raw materials, components, licenses, content, energy, or capital equipment
- whether suppliers are global, regional, or local
- whether the company relies on third parties for critical manufacturing, fulfillment, transportation, installation, or service delivery
- which supplier categories are mission-critical versus easily replaceable

2. Supplier segmentation
Break the supplier base into the most important categories.
For each category, describe:
- who the suppliers are
- what they provide
- how important they are to operations, cost of goods sold, or opex
- whether they are concentrated or fragmented
- whether costs are fixed, variable, usage-based, contract-based, or commodity-linked
- whether the company discloses these categories explicitly or whether you are inferring them

3. Key suppliers and named counterparties
Identify the most important actual suppliers or counterparties where possible.
Include:
- supplier names
- what they provide
- whether they appear to be sole-source, dual-source, or one of many
- any evidence of strategic dependence
- whether the supplier relationship appears long-term, transactional, or vulnerable
- whether these suppliers have bargaining leverage over the company

If exact suppliers are not disclosed, identify the most likely supplier types and leading industry vendors the company probably relies on.

4. What the company is buying
Explain exactly what the company needs from suppliers.
Examples may include:
- raw materials
- finished inventory
- components
- contract manufacturing
- freight / shipping
- store merchandise
- semiconductors
- packaging
- cloud infrastructure
- software licenses
- media / content rights
- labor / staffing
- fuel / energy
- network capacity
- maintenance services
- real estate / leased assets
Discuss:
- how essential each input is
- whether it is specialized or commoditized
- whether quality matters more than price
- whether inputs are standardized or tailored to the company

5. Procurement process and purchasing mechanics
Explain how the company likely buys from suppliers.
Address questions such as:
- whether procurement is centralized or decentralized
- whether purchases are made through annual contracts, spot buys, auctions, RFPs, bids, negotiated agreements, framework agreements, or distributor channels
- whether supplier relationships are short-term or multi-year
- whether there are take-or-pay commitments, minimum purchase obligations, volume rebates, exclusivity terms, or price adjustment clauses
- whether the company carries inventory buffers or operates lean / just-in-time
- whether procurement depends on long lead times or seasonal ordering

6. Supplier bargaining power
Assess who has leverage in the relationship.
Discuss:
- whether suppliers are large and sophisticated or fragmented and undifferentiated
- whether the company is an important customer to the supplier
- whether the supplier provides something scarce, regulated, proprietary, or capacity-constrained
- whether the company can credibly switch or dual-source
- whether suppliers have recently raised prices or tightened terms
Then give a reasoned view on:
- who has negotiating leverage
- how exposed the company is to cost inflation
- how easily margin pressure can be passed through to customers

7. Alternatives and substitute suppliers
Analyze what alternatives the company has.
Include:
- alternative suppliers by category
- in-house production / insourcing as an option
- substitute materials or technologies
- geographic diversification options
- low-cost versus premium alternatives
For each major input, explain:
- how realistic alternatives are
- what prevents switching
- what the cost, timing, and execution risk of switching would be

8. Concentration and dependency risk
Assess supplier concentration.
Discuss:
- whether the company relies heavily on one or a few suppliers
- whether any single vendor, manufacturing partner, cloud provider, content provider, logistics partner, or raw-material source appears disproportionately important
- whether there are geographic concentrations
- whether there are country-specific, regulatory, geopolitical, or tariff risks
- whether there are hidden dependencies through subcontractors or upstream bottlenecks
Then provide a blunt view on:
- sole-source risk
- disruption risk
- repricing risk
- shortage risk

9. Switching costs and operational dependence
Assess how hard it would be for the company to replace key suppliers.
Discuss:
- technical qualification requirements
- certification / regulatory approval
- tooling / redesign needs
- software integration
- retraining or workflow disruption
- manufacturing revalidation
- long-term contracts
- relationship / trust factors
- logistics network complexity
- time required to transition
Then give a view on:
- practical switching difficulty
- short-term versus long-term replaceability
- how much hidden fragility exists in the supply chain

10. Cost structure and margin implications
Translate the supplier analysis into economics.
Discuss:
- which supplier categories matter most to gross margin or EBITDA margin
- which costs are most volatile
- which inputs are commodity-exposed
- which costs are contractually fixed or escalator-based
- whether the company benefits from scale purchasing
- whether procurement efficiency is a competitive advantage or weakness
- how supplier inflation, shortages, or mix changes affect profitability

11. Industry structure from the supplier side
Explain the supplier landscape in the relevant industry.
Address:
- whether suppliers are concentrated or fragmented
- whether there are dominant vendors
- whether the company competes with peers for scarce capacity
- whether supply availability is cyclical
- whether industry-wide shortages, overcapacity, or consolidation affect bargaining power
- whether peers appear to have better or worse supplier access

12. Evidence from company disclosures
Pull together the most important direct evidence from:
- 10-K risk factors
- MD&A
- cost of revenue / operating expense discussion
- inventory commentary
- supply chain discussion
- tariff / freight / input cost discussion
- earnings call commentary
- investor presentations
- any disclosed agreements or procurement references
Summarize the specific passages or disclosures that reveal supplier dependence, procurement mechanics, and supply risk.

13. Red flags and key debates
List the major issues an investor should debate about this supplier base, such as:
- hidden supplier concentration
- sole-source risk
- rising dependence on powerful vendors
- inability to pass through cost inflation
- supplier financial distress
- geopolitical or tariff exposure
- fragile logistics
- inventory underinvestment
- overreliance on outsourced manufacturing
- cloud / software lock-in
- commodity price volatility
- labor scarcity or wage pressure

14. Forecasting implications
Translate the supplier analysis into modeling implications.
Discuss:
- what drives input cost inflation or deflation
- what variables matter most for forecasting margins
- what lead indicators help track supplier pressure
- which costs are likely controllable versus external
- where disruptions would show up first in the financials
- which supplier categories deserve the closest monitoring

15. Bottom line
Conclude with a blunt assessment:
- How attractive is this supplier structure?
- Does the company control its supply chain, or is it at the mercy of others?
- Where is it strongest and weakest?
- Is procurement a competitive advantage, neutral factor, or major risk?
- How vulnerable is the company to shortages, repricing, concentration, or disruption?

SPECIAL REQUEST
Where possible, include:
- names of major suppliers
- examples of actual supplier relationships
- evidence of how procurement decisions are made
- signs of whether the company wins through scale, diversification, engineering, long-term contracts, or simple lack of alternatives
- signs of whether supplier issues could impair volume, service levels, margins, or capital needs

If exact information is unavailable, say so clearly and give the best-supported inference.

OPTIONAL INDUSTRY-SPECIFIC ANGLES
Where relevant, tailor the analysis to the company’s business model:

For consumer / retail companies:
- branded vendors vs private label suppliers
- sourcing countries
- seasonal ordering
- freight exposure
- markdown risk tied to procurement mistakes

For industrial / manufacturing companies:
- raw materials
- components
- contract manufacturers
- plant-level sourcing
- qualification and tooling constraints

For software / digital / internet companies:
- cloud vendors
- data providers
- traffic acquisition
- payment processors
- infrastructure dependence
- third-party platform risk

For telecom / media companies:
- network equipment vendors
- tower / fiber / lease counterparties
- handset suppliers
- content suppliers
- programming costs
- vendor financing
- spectrum-related counterparties

For healthcare / pharma / medtech companies:
- API suppliers
- CMOs / CDMOs
- distributors
- GPO dynamics
- regulatory qualification of suppliers
- manufacturing redundancy

For transportation / services / labor-heavy companies:
- labor pools
- fleet OEMs
- maintenance vendors
- fuel suppliers
- insurance
- airport / real estate counterparties
- outsourced service providers
`;

