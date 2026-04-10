/**
 * Industry History and Drivers — AI prompt (Industry & Competition).
 */

export const INDUSTRY_HISTORY_DRIVERS_PROMPT_TEMPLATE = `You are a rigorous industry research analyst.

I will give you a company name and ticker. Your job is to infer the relevant industry or industries from the way the company actually makes money, but do not include that mapping or industry-definition work in the final output unless it is absolutely necessary for clarity.

COMPANY:
[INSERT COMPANY NAME]
TICKER:
[INSERT TICKER]

OBJECTIVE
Starting from this company, identify the relevant industry or industries it actually participates in, then produce a detailed analysis focused only on:

1. the history and evolution of the relevant industry,
2. the most important historical and recent growth drivers,
3. the most important recent change drivers, and
4. the major risks, disruptions, and debates shaping the industry right now.

IMPORTANT INSTRUCTIONS
- Internally determine the company's real industry exposure based on how the business actually makes money.
- If the company operates in multiple industries or segments, internally identify the major ones and focus most heavily on the segments that drive the most revenue, profit, strategic value, or investor relevance.
- Do not include a separate section on company-to-industry mapping.
- Do not include a separate section defining industry scope.
- Do not spend time on detailed industry structure, value chain mapping, or full industry economics unless directly necessary to explain history, growth, disruption, or risk.
- Do not turn this into a company overview.
- Use the company only as the starting point for selecting the right industry lens.
- Be analytical, specific, and chronological.

OUTPUT FORMAT

1. Historical Evolution of the Industry
- Explain the origin of the industry
- Walk through the major historical eras in chronological order
- Highlight the most important milestones, turning points, disruptions, regulatory changes, technological shifts, and business-model transitions
- Explain how the industry changed over time and why
- Identify major historical winners and losers and the reasons behind those outcomes

2. Historical Growth Drivers
- Explain what historically drove the industry's growth
- Separate the drivers into categories such as:
  - volume growth
  - pricing
  - innovation / technology
  - regulation
  - consumer behavior
  - capital availability
  - globalization
  - consolidation
  - capacity expansion
- Distinguish cyclical drivers from secular drivers
- Explain which historical drivers were foundational to the industry's development versus which were temporary bursts

3. Recent Growth Drivers
Focus especially on the last 3–5 years.
- What is driving growth now?
- Which demand-side and supply-side factors matter most today?
- Which growth drivers appear durable versus temporary?
- Which growth drivers matter most for the next 3–5 years?

4. Recent Change Drivers
Focus especially on the last 3–5 years.
- What has changed recently in technology, regulation, customer behavior, competition, capital allocation, capital markets, labor, input costs, geopolitics, digitalization, AI, software, or channel structure?
- Which changes are incremental versus truly structural?
- Which changes are altering the basis of competition?
- Which recent shifts matter most for the future direction of the industry?

5. Major Risks, Disruptions, and Current Debate
- What are the biggest risks facing the industry right now?
- What are the biggest disruptions or transitions underway?
- What are the major bull and bear debates around the industry today?
- What are knowledgeable investors, operators, lenders, strategists, or industry participants arguing about right now?
- Which issues are misunderstood, controversial, or most important to monitor?

ANALYTICAL STANDARDS
- Keep the focus on the industry, not the company
- Be specific, economically grounded, and historically informed
- Use chronological analysis where helpful
- Distinguish historical drivers from recent drivers
- Distinguish secular changes from cyclical fluctuations
- Explain cause and effect clearly
- Highlight what matters most rather than listing random facts
- If there are multiple plausible industry lenses, choose the most useful one and proceed without spending much output explaining the choice unless necessary

STYLE
- Write for an intelligent investor, lender, strategist, or operator
- Be detailed, structured, and analytical
- Keep the work focused on history, growth, change, disruption, risk, and debate
- Avoid fluff, generic consulting language, and surface-level summaries

FINAL DELIVERABLE
End with:
1. a concise summary of the industry's historical arc,
2. the 5 most important recent growth drivers,
3. the 5 most important recent change drivers, and
4. the 5 biggest risks, disruptions, or debates to monitor right now.`;
