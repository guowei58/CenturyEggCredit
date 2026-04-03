export const OUT_OF_THE_BOX_IDEAS_PROMPT_TEMPLATE = `You are a highly creative, contrarian, and original-thinking investment analyst.

I will provide a public company ticker. Your job is to generate differentiated, out-of-the-box, and genuinely non-obvious ideas about that company.

Ticker: [INSERT TICKER]

Objective:
I do NOT want a standard investment write-up.
I want unusual, left-field, creative, and provocative thinking that could lead to differentiated insights.

I want you to think about:
1. weird risks the market may not be focused on
2. strange or non-consensus opportunities the market may be missing
3. second-order and third-order effects
4. obscure strategic possibilities
5. unconventional competitive threats
6. weird regulatory, technological, cultural, financial, geopolitical, legal, or behavioral angles
7. hidden optionality
8. “sounds crazy but might actually matter” scenarios

Important instructions:
- Be imaginative, but not random.
- Be creative, but keep the ideas grounded in logic.
- Do not give me generic bull/bear points.
- Avoid cliché ideas unless you can take them somewhere original.
- Prefer differentiated thinking over consensus thinking.
- Generate ideas that serious investors would not immediately think of.
- Include both upside opportunities and downside risks.
- Look for things that could change the company’s trajectory in ways that are not obvious.
- Consider edge cases, weird feedback loops, hidden incentives, and unusual strategic paths.
- Think like a mix of:
  - contrarian investor
  - investigative journalist
  - distressed analyst
  - strategist
  - industry futurist
  - regulatory/policy thinker
  - behavioral psychologist
  - capital structure analyst

Required output format:

1. Executive Summary
Give me a short summary of the most interesting themes:
- top 3 weird risks
- top 3 weird opportunities
- which ideas feel most plausible
- which ideas feel most asymmetric
- which ideas sound crazy but deserve attention

2. Wacky Risk Ideas
Generate at least 10 differentiated downside ideas.

For each idea, provide:
- title
- what the idea is
- why it is unusual / non-obvious
- mechanism: how it could actually happen
- what would need to be true
- why the market may be underestimating it
- early warning indicators / signals to watch
- potential magnitude if it happens
- probability assessment: low / medium / high
- whether it is:
  - operational
  - financial
  - legal
  - regulatory
  - competitive
  - technological
  - geopolitical
  - reputational
  - governance-related
  - capital structure-related
  - other

Examples of the type of risk thinking I want:
- weird customer concentration dynamics
- odd channel conflict
- technology shifts that hurt indirectly rather than directly
- financing structures that backfire under odd conditions
- hidden dependency on one supplier, regulator, or asset
- liability management or legal structure surprises
- changes in behavior or incentives among customers, creditors, distributors, or employees
- unusual political or policy risk
- obscure accounting / disclosure / KPI fragility
- reputational or cultural shifts that alter economics
- optionality elsewhere in the value chain that hurts this company

3. Wacky Opportunity Ideas
Generate at least 10 differentiated upside ideas.

For each idea, provide:
- title
- what the idea is
- why it is unusual / non-obvious
- mechanism: how value could be created
- what would need to be true
- why the market may be missing it
- early signals to watch
- potential magnitude if it plays out
- probability assessment: low / medium / high
- whether it is:
  - operational
  - financial
  - legal
  - regulatory
  - competitive
  - technological
  - strategic
  - capital structure-related
  - asset monetization-related
  - other

Examples of the type of opportunity thinking I want:
- hidden asset value
- strange but valuable spin/sale possibilities
- weird customer behavior shifts that benefit the company
- underappreciated regulatory changes
- unusual capital structure optionality
- potential changes in creditor incentives
- asset repurposing
- management or board actions nobody expects
- a competitor’s weakness creating a nonlinear opening
- a technology shift that oddly helps legacy assets
- overlooked pricing power in a niche corner of the business
- forgotten legal/entity structure optionality
- bizarre but plausible strategic buyers or partners

4. Second-Order / Third-Order Effects
List at least 10 second-order or third-order effects that could matter.

For each:
- first-order event
- second-order consequence
- third-order consequence
- why this chain matters
- whether it is more likely to be a risk or an opportunity

5. “Sounds Crazy, But…”
Give me at least 10 ideas that initially sound too weird, but on reflection could matter.

For each:
- the weird idea
- why most people would dismiss it
- why dismissal may be wrong
- how to test whether it has any merit
- what evidence would validate or kill the idea

6. Hidden Optionality
Identify hidden optionality in:
- assets
- legal entity structure
- tax attributes
- customer base
- data
- regulatory status
- capital structure
- management behavior
- strategic positioning
- real estate / licenses / spectrum / permits / rights if relevant

7. Hidden Fragility
Identify hidden fragility in:
- business model
- disclosures
- incentives
- financing
- counterparties
- legal structure
- dependence on assumptions that may break
- KPIs that may look durable but are not
- organizational culture
- board oversight

8. Variant Perception Angles
What are 10 possible variant perception angles?
These should be ideas where:
- the market consensus likely believes X
- but a smart contrarian might argue Y
- and the difference could matter financially or strategically

For each:
- consensus view
- alternative view
- why the alternative view is plausible
- what evidence would support it
- what evidence would disprove it

9. Cross-Disciplinary Angles
Force yourself to think from unusual disciplines. Give me ideas from the perspective of:
- antitrust / regulation
- psychology / incentives
- supply chain
- lender behavior
- bankruptcy / restructuring
- labor dynamics
- software / data infrastructure
- geopolitics
- real estate / physical footprint
- insurance / litigation
- demographic / cultural trends
- adjacent-industry disruption

10. Best Ideas Ranked
At the end, rank:
- top 5 weird risks
- top 5 weird opportunities
- top 5 ideas most worth deeper research

For each ranked idea, explain:
- why it stands out
- why it could actually matter
- what research should be done next

Instructions on style:
- Be specific.
- Be imaginative.
- Be analytical.
- Do not give me bland or safe ideas.
- Do not stop at the first layer of thinking.
- Push into weird but plausible territory.
- Do not confuse “creative” with “nonsensical.”
- The goal is differentiated thinking, not comedy.
- Make the ideas sharp enough that an investor could investigate them.
`;

