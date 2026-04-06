/**
 * Industry value chain research prompt. Replace [INSERT TICKER] and [INSERT COMPANY NAME, IF KNOWN] in the tab UI.
 */

export const INDUSTRY_VALUE_CHAIN_PROMPT_TEMPLATE = `You are a meticulous industry and value-chain research assistant.

I will provide a public company ticker and, if helpful, the company name.

Your job is to identify the company's true industry value chain and explain how value, bargaining power, capital, and risk move across that chain.

INPUTS
TICKER: [INSERT TICKER]
COMPANY NAME: [INSERT COMPANY NAME, IF KNOWN]

OBJECTIVE
Build a detailed industry value chain for this company's core business lines.

I do NOT want a generic industry overview. I want a practical, investor-grade map of how the industry actually works:
- who supplies inputs
- who owns key assets
- who provides financing
- who distributes or sells the product/service
- who captures the economics
- where the company sits in the chain
- which players have the most bargaining leverage
- how the chain may change over time

For example, in car rental:
- OEMs manufacture and sell vehicles
- financing providers help fund vehicle ownership
- rental companies acquire and operate fleets
- vehicles are rented to customers
- vehicles are later disposed into used vehicle channels

I want that same kind of chain built for whatever ticker I enter.

RESEARCH INSTRUCTIONS
Use the company's:
- 10-K
- 10-Q
- 8-K
- annual report
- investor presentations
- earnings call transcripts

Also use relevant industry sources, trade publications, rating agency reports, and reputable market research where useful.

If the company has multiple major business lines, build the value chain around the segments that matter most economically. If needed, provide separate mini-value chains by segment.

OUTPUT FORMAT

1. COMPANY POSITIONING SUMMARY
Start with a short summary:
- what the company actually does
- where it sits in the industry value chain
- how it makes money
- what upstream and downstream parties it depends on

2. VALUE CHAIN DIAGRAM
Draw the value chain in a simple text-based flow format, such as:

[Raw materials / inputs]
→ [component suppliers]
→ [manufacturers / asset owners]
→ [financing providers]
→ [distributors / operators]
→ [end customers]
→ [secondary market / disposal / recycling / servicing]

Include all important steps.
Also include important side nodes where relevant, such as:
- financing
- insurance
- servicing / maintenance
- software / technology
- regulators
- logistics
- remarketing / resale
- aftermarket / consumables

3. VALUE CHAIN TABLE
Create a table with the following columns:

- Step in value chain
- What happens at this step
- Typical participants / examples
- Revenue model / economics
- Capital intensity
- Margin profile
- Bargaining power
- Key risks
- Importance to the target company

Be specific. Avoid vague filler.

4. DETAILED EXPLANATION OF EACH STEP
For each part of the value chain, explain:
- what function it performs
- who typically plays that role
- whether it is commoditized or differentiated
- whether it is asset-heavy or asset-light
- what determines returns at that step
- whether the economics are cyclical, regulated, scale-driven, or technology-driven
- how dependent the target company is on this step

5. BARGAINING POWER / LEVERAGE ANALYSIS
Analyze who has the most leverage in the value chain and why.

Discuss:
- who sets prices versus who takes prices
- switching costs
- customer concentration
- supplier concentration
- brand strength
- asset scarcity
- regulatory protection
- network effects
- financing dependence
- replacement cycles
- importance of scale
- ownership of customer relationship
- ownership of scarce data, infrastructure, distribution, or IP

Then rank the major players in the value chain by relative bargaining power:
1. strongest leverage
2. next strongest
3. middle
4. weaker
5. weakest / most commoditized

Be explicit and explain the logic.

6. WHERE VALUE ACCRUES
Explain where profits and economic value tend to accrue across the chain.

Address:
- which step tends to earn the highest margins
- which step tends to earn the highest returns on capital
- which step bears the most operational risk
- which step bears the most balance sheet risk
- which step is most vulnerable to competition
- whether value capture is stable or shifts over time

7. ROLE OF FINANCING IN THE VALUE CHAIN
If financing is important, explain it clearly.

Examples:
- vehicle financing
- floorplan financing
- ABS
- leasing
- equipment finance
- project finance
- working capital lines
- vendor finance
- trade credit
- customer financing

Explain:
- who provides the capital
- who takes residual risk
- whether financing is essential to industry growth
- how financing affects bargaining power and returns
- whether tighter financing could change the industry structure

8. CHANGES AND EVOLUTION IN THE VALUE CHAIN
Discuss potential changes in the value chain over the next 3–5 years.

Include:
- disintermediation risks
- vertical integration
- outsourcing
- consolidation
- digitization / software layer growth
- AI / automation
- regulation
- supply chain shifts
- changes in financing availability
- changes in customer purchasing behavior
- new entrants
- used / secondary market changes
- technology substitution

Focus on what could change who captures value.

9. PRESSURE POINTS AND INVESTMENT IMPLICATIONS
Identify the most important pressure points for investors:
- fragile links in the chain
- cost inflation points
- dependency on a small number of suppliers/customers
- margin squeeze risk
- inventory / working capital risk
- financing risk
- regulatory bottlenecks
- disruption risk
- residual value risk
- channel conflict

Then explain:
- what part of the value chain I should monitor most closely
- what metrics or disclosures matter most
- what would signal improving or worsening bargaining power for the company

10. CONCLUSION
End with a concise conclusion:
- where this company sits in the chain
- whether it has strong or weak bargaining power
- whether it is likely to gain or lose value share over time
- the top 3 value-chain questions an investor should keep asking

IMPORTANT RULES
- Do not be generic.
- Do not just describe the company; map the full industry structure around it.
- Show the chain from upstream inputs to downstream monetization and end-of-life / secondary market where relevant.
- Include financing as part of the chain whenever it is economically important.
- Be specific about who has leverage and why.
- If the company participates in multiple value chains, focus first on the one that drives the most revenue, EBITDA, or enterprise value.
- Where possible, tie the analysis to actual company disclosures and industry structure rather than abstract theory.
- If there are major uncertainties, say so clearly.

STYLE
Write like a sharp buyside industry analyst:
- clear
- structured
- commercially minded
- focused on economics, incentives, bargaining power, capital intensity, and change over time
- no fluff
`.trim();

export function resolveIndustryValueChainTemplate(
  tpl: string,
  ticker: string,
  companyName: string | null | undefined
): string {
  const tk = ticker.trim();
  const n = companyName?.trim();
  const nameLine =
    n && n.toUpperCase() !== tk.toUpperCase()
      ? n
      : "Not provided in app — infer from ticker, SEC, and IR.";
  return tpl.replace(/\[INSERT TICKER\]/g, tk).replace(/\[INSERT COMPANY NAME, IF KNOWN\]/g, nameLine);
}
