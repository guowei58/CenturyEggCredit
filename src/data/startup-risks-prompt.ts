/**
 * Startup Risks AI prompt.
 * Replace [TICKER] in the tab UI.
 */

export const STARTUP_RISKS_PROMPT_TEMPLATE = `You are a top-tier industry analyst, venture ecosystem researcher, and competitive strategist. I will give you a public company ticker. Your job is to identify the start-ups and emerging private companies operating in the same space, broken down by each major business line, function, segment, or profit pool of the company.

The goal is not just to list competitors. The goal is to help me understand where the competitive landscape may change because of new technology, new business models, new distribution models, new cost structures, or new customer behavior.

I want to know where disruption may come from so I am not caught off guard.

Important instructions:

- Start by breaking the company into its major business segments, functions, revenue streams, customer use cases, and value chain positions.
- For each segment or function, identify relevant start-ups, venture-backed challengers, private companies, or emerging platforms that could affect the competitive landscape.
- Do not focus only on direct substitutes. Also include adjacent or indirect threats that could weaken pricing, reduce demand, disintermediate incumbents, compress margins, or shift value to another part of the ecosystem.
- Focus especially on:
  - technological innovation
  - software / automation innovation
  - AI or data-driven disruption
  - marketplace or platform business models
  - asset-light vs asset-heavy business model differences
  - new distribution models
  - vertical integration strategies
  - lower-cost operating models
  - customer acquisition innovation
  - unbundling / rebundling of value chains
  - regulatory or infrastructure changes that enable new entrants
- Include companies that are still small if they are strategically important.
- Include emerging business model changes even if the companies are not yet large.
- Distinguish clearly between:
  1. direct competitors,
  2. adjacent disruptors,
  3. enabling technology vendors,
  4. business model innovators,
  5. companies attacking only one profitable niche.
- Do not just give me names. Explain why each matters.
- Be skeptical and commercially focused.
- Think like a public-market investor trying to understand what could change industry economics over the next 3–10 years.

Please produce the output in the exact structure below.

==================================================
1. EXECUTIVE SUMMARY
==================================================

Provide:
- short description of the company’s competitive landscape
- top 10 start-ups or emerging private companies I should care about most
- top 5 ways the industry may change over the next 3–10 years
- whether disruption risk appears low, medium, or high
- which segment of the company looks most exposed
- which segment looks most defensible
- what type of innovation matters most here:
  - technology
  - business model
  - distribution
  - cost structure
  - customer behavior
  - regulation
  - other

==================================================
2. COMPANY SEGMENT / FUNCTION MAP
==================================================

Break the company into:
- business segments
- products / services
- customer types
- functional layers of the value chain
- revenue streams
- profit pools
- strategic assets / moats

Then for each segment / function, explain:
- what the incumbent company does
- how it makes money
- what customers are buying
- what part of the value chain is most vulnerable to change
- where start-ups are most likely to attack

==================================================
3. START-UP LANDSCAPE BY SEGMENT
==================================================

For each segment / function, create a section with the following:

Segment / Function Name:
- What this part of the business does
- Why it matters economically
- What makes it vulnerable or defensible

Then list relevant start-ups / emerging private companies in a table with these columns:

| Company | What It Does | Direct / Adjacent / Enabler | Innovation Type | Business Model Innovation | Why It Matters | Threat Level |

Where:
- Direct / Adjacent / Enabler = whether it competes directly, attacks an adjacent layer, or supplies enabling technology that could shift industry power
- Innovation Type = AI / software / hardware / platform / marketplace / vertical integration / automation / pricing / distribution / other
- Business Model Innovation = explain how the model differs from incumbents
- Why It Matters = one concise sentence on strategic relevance
- Threat Level = Low / Medium / High

After each segment table, explain:
- which start-ups matter most
- which ones could affect pricing power
- which ones could take share
- which ones could change industry structure without taking large share directly
- which ones look overhyped vs genuinely important

==================================================
4. EMERGING THEMES / DISRUPTION VECTORS
==================================================

Identify the major innovation themes in the space, such as:
- AI automation
- vertical software
- digital marketplaces
- embedded finance
- usage-based pricing
- direct-to-consumer models
- asset-light models
- robotics / autonomy
- data network effects
- supply chain redesign
- new manufacturing processes
- regulatory arbitrage
- infrastructure sharing
- open-source or low-cost offerings
- unbundling of legacy bundled services
- niche specialists taking the highest-margin pieces

For each theme, explain:
- what is changing
- which start-ups are leading it
- which segment of the company is exposed
- whether this is near-term or longer-term
- whether this threatens revenue, margins, customer ownership, or strategic relevance

==================================================
5. NON-OBVIOUS COMPETITIVE THREATS
==================================================

Identify threats that are easy to miss, including:
- start-ups in adjacent categories
- companies changing customer workflows
- vendors becoming platforms
- customers insourcing functions
- infrastructure providers moving up the stack
- software layers commoditizing incumbent services
- companies attacking only the most profitable slice of the value chain
- start-ups whose model looks small today but could matter strategically later

Then explain:
- why a public-market investor might overlook them
- what signal would tell me they are becoming important

==================================================
6. BUSINESS MODEL INNOVATION ANALYSIS
==================================================

Explain how the emerging companies differ from the incumbent on:
- pricing model
- cost structure
- capital intensity
- go-to-market
- product bundling
- speed of iteration
- use of data / AI / automation
- customer acquisition
- customer switching friction
- scalability
- regulatory positioning

Then tell me:
- which innovations are cosmetic
- which innovations could actually change economics
- which innovations are most dangerous to incumbent returns

==================================================
7. TECHNOLOGY WATCHLIST
==================================================

Identify the key technology shifts I should monitor in this space:
- technologies that reduce cost
- technologies that improve product performance
- technologies that bypass incumbent infrastructure
- technologies that change customer expectations
- technologies that enable new entrants
- technologies that may weaken the company’s moat

For each technology, explain:
- what it does
- which start-ups are building on it
- how it could affect the company
- what milestones would signal real adoption

==================================================
8. MARKET MAP
==================================================

Create a market map in text form:

[Segment / Function A]
  -> Direct challengers
  -> Adjacent challengers
  -> Enablers
  -> Most important innovation trend

[Segment / Function B]
  -> Direct challengers
  -> Adjacent challengers
  -> Enablers
  -> Most important innovation trend

Repeat for all major segments.

==================================================
9. WHAT TO WATCH GOING FORWARD
==================================================

Give me a practical monitoring checklist.

Include:
- start-ups I should track most closely
- metrics to watch
- customer adoption signals
- funding signals
- partnership signals
- M&A signals
- product launch signals
- regulatory signals
- pricing signals
- signs the incumbent is losing relevance
- signs the incumbent is adapting well
- questions I should ask on earnings calls or in channel checks

==================================================
10. RED FLAGS / INCUMBENT RISK ASSESSMENT
==================================================

Tell me:
- which segment is most at risk of disruption
- which start-up or category of start-up is most dangerous
- whether the incumbent is likely to respond effectively
- whether the threat is likely to show up first in growth, margins, pricing, capex needs, customer churn, or valuation multiple
- whether this is likely to be gradual or nonlinear

==================================================
11. FINAL SCORECARD
==================================================

Score each major segment from 1 to 5, where:
1 = low disruption risk
5 = high disruption risk

Score:
- direct start-up competition
- business model disruption risk
- technology disruption risk
- pricing pressure risk
- disintermediation risk
- margin compression risk
- moat durability
- management response risk

Then provide:
- overall disruption risk score
- 1 paragraph on why
- 1 paragraph on what matters most for an investor

==================================================
12. APPENDIX: START-UP LIST
==================================================

Create a final consolidated list of all relevant start-ups / emerging private companies mentioned, with:
- company name
- segment attacked
- innovation category
- why it matters in one sentence

Final instructions:
- Be comprehensive, not superficial.
- Organize by segment / function, not just by company.
- Emphasize what is changing in the industry, not just who exists.
- Prioritize innovations that could alter economics, bargaining power, customer ownership, or the shape of the value chain.
- Distinguish real threats from hype.
- Think like an investor trying to avoid being blindsided.

I will now give you the ticker:

[TICKER]`;

