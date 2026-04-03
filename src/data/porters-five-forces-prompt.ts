/**
 * Porter's Five Forces AI prompt.
 * Replace [COMPANY NAME / TICKER] in the tab UI (e.g. "Acme Corp (ACME)").
 */

export const PORTERS_FIVE_FORCES_PROMPT_TEMPLATE = `You are a highly rigorous industry analyst applying Porter's Five Forces to understand the strategic and economic positioning of [COMPANY NAME / TICKER].

Your task is not to give me a generic strategy summary. Your task is to determine how favorable or unfavorable the industry structure is for the company, what drives that positioning, how it varies across the company's business lines, and what that implies for margins, returns, and durability.

Use Porter's Five Forces as the core framework:
1. Rivalry among existing competitors
2. Threat of new entrants
3. Bargaining power of suppliers
4. Bargaining power of customers
5. Threat of substitutes

If the company has multiple business lines, do NOT analyze the company only at the consolidated level. Break the analysis down by each economically distinct business line, because different business lines often face very different industry structures and economics.

==================================================
SCORING SYSTEM
==================================================
For each force, assign a score from 1 to 5 based on how favorable or unfavorable that force is for the company's positioning:

1 = very bad for the company's positioning
2 = somewhat bad
3 = mixed / neutral
4 = good
5 = very good for the company's positioning

Important:
This is NOT a score for the raw strength of the force by itself.
This IS a score for how favorable the force is for the company.

Examples:
- intense rivalry usually leads to a low score
- weak substitute pressure usually leads to a high score
- strong customer bargaining power usually leads to a low score
- strong entry barriers usually lead to a high score

Be explicit throughout that the score reflects how favorable the force is for the company's economics and competitive position.

==================================================
SOURCE PRIORITY
==================================================
Use the best available primary and high-quality secondary sources, prioritizing:
1. latest 10-K
2. latest 10-Q
3. latest earnings call transcript
4. investor presentation / investor day materials
5. major competitors' filings
6. rating agency reports if available
7. trade publications, regulatory sources, and industry reports where needed
8. market share, pricing, margin, or share-of-wallet data where available

Do not rely only on management's narrative.
Cross-check management claims against actual industry structure and competitor behavior.

If information is missing or uncertain, say so clearly.

==================================================
CORE OBJECTIVE
==================================================
I want to understand:
- how favorable or unfavorable the industry structure is for the company
- which of the five forces most help or hurt the company
- why this company or business line earns good, mediocre, or poor returns
- whether the company's business lines face different force profiles
- what may change the force structure over time
- whether the company has real advantages that offset industry pressure

==================================================
STEP 1: DEFINE THE RELEVANT MARKET CORRECTLY
==================================================
Before applying the framework, first define the relevant market carefully.

For the company as a whole, and then for each business line if applicable, explain:
- what the business actually sells
- who the customers are
- who the real competitors are
- what geographic markets matter
- what product categories are truly relevant
- what adjacent markets should NOT be mixed in
- whether management's reported segments map cleanly to real economic markets

Do not blindly use reported segment labels if they hide economically different businesses.

If necessary, reframe the company into economically distinct business lines.

==================================================
STEP 2: BUSINESS LINE BREAKDOWN
==================================================
If the company has multiple business lines, identify each economically distinct business line and analyze each one separately.

For each business line, briefly provide:
- business line name
- what it sells
- who the customers are
- main competitors
- revenue model
- margin characteristics
- capital intensity
- cyclicality
- strategic importance to the parent

Then apply the full Five Forces framework to each business line.

==================================================
STEP 3: ANALYZE EACH OF THE FIVE FORCES IN DEPTH
==================================================
For each force, provide:
A. Score (1-5)
B. Clear explanation of why
C. Key evidence
D. Direction of travel (improving, worsening, stable)
E. What could change the score over time
F. Why this score is good or bad for the company's positioning

For each force, analyze the following:

------------------------------
1. RIVALRY AMONG EXISTING COMPETITORS
------------------------------
Examine:
- number of competitors
- market concentration
- market share stability
- pricing behavior
- frequency of price wars
- capacity additions / oversupply
- product differentiation
- switching costs
- fixed-cost intensity
- exit barriers
- industry growth rate
- history of margin volatility
- whether competition is rational or irrational

Ask:
- Is competition mostly on price, service, quality, innovation, scale, distribution, or relationships?
- Are there repeated signs that competitors destroy returns?
- Is the market consolidating or fragmenting?
- Does rivalry help or hurt the company's position?

------------------------------
2. THREAT OF NEW ENTRANTS
------------------------------
Examine:
- capital requirements
- economies of scale
- brand strength
- customer switching costs
- regulatory barriers
- licensing requirements
- distribution access
- technology barriers
- network effects
- access to data or scarce assets
- know-how / execution complexity
- incumbent retaliation risk
- private equity / startup / foreign entrant risk

Ask:
- How hard is it to enter credibly?
- Can entrants scale profitably, or only participate marginally?
- Are barriers truly durable, or just overstated by incumbents?
- Is the threat of entry favorable or unfavorable for the company?

------------------------------
3. BARGAINING POWER OF SUPPLIERS
------------------------------
Examine:
- supplier concentration
- availability of alternative suppliers
- input substitutability
- switching costs
- importance of labor
- unionization / labor scarcity
- access to raw materials / components / content / bandwidth / inventory / funding
- importance of specialized technology vendors
- dependence on key platforms or distribution intermediaries
- whether suppliers can forward-integrate
- whether input costs are volatile
- ability to pass through input inflation

Ask:
- Which suppliers really matter economically?
- Can suppliers squeeze margins materially?
- Is supplier power cyclical or structural?
- Is supplier power favorable or unfavorable for the company?

------------------------------
4. BARGAINING POWER OF CUSTOMERS
------------------------------
Examine:
- customer concentration
- size and sophistication of buyers
- switching costs
- contract duration
- pricing transparency
- importance of the product to the customer
- customer procurement behavior
- bid-based purchasing
- risk of insourcing
- availability of alternatives
- churn risk
- whether customers can force rebates, service upgrades, or better terms
- whether the company is a critical vendor or a replaceable vendor

Ask:
- Who really has the leverage in the relationship?
- How much pricing power does the company actually have?
- Are the company's customers price-sensitive, service-sensitive, or mission-critical buyers?
- Is customer power favorable or unfavorable for the company?

------------------------------
5. THREAT OF SUBSTITUTES
------------------------------
Examine:
- alternative products or services
- technological displacement risk
- customer willingness to switch to different solutions
- relative cost-performance of substitutes
- whether substitutes are good enough vs better
- adoption curve of substitutes
- behavioral or regulatory frictions slowing substitution
- long-term secular change
- whether substitution pressure differs by customer segment

Ask:
- What else can solve the customer's problem?
- Is substitution gradual, cyclical, or existential?
- Are substitutes pressuring pricing, volume, or both?
- Is substitute pressure favorable or unfavorable for the company?

==================================================
STEP 4: FORCE SCORING TABLE
==================================================
For the company as a whole, and separately for each business line, provide a table with:

- Force
- Score (1-5)
- Why this score
- Trend (improving / worsening / stable)
- Main implication for margins / returns
- Main implication for the company's positioning

==================================================
STEP 5: OVERALL INDUSTRY / POSITIONING ASSESSMENT
==================================================
After analyzing all five forces, assess the overall favorability of the industry structure for each business line and for the company overall.

Provide:
- overall positioning score (1-5), where:
  1 = very unfavorable for the company
  2 = unfavorable
  3 = mixed / average
  4 = favorable
  5 = very favorable for the company
- short explanation of why
- which force hurts the company most
- which force helps the company most
- whether returns are structurally supported or structurally pressured
- whether the company's own advantages overcome industry headwinds

Important:
Be clear that this overall score is about how favorable the force structure is for the company, not just about whether the company is well-managed.

==================================================
STEP 6: WHAT MAKES THIS BUSINESS A GOOD OR BAD BUSINESS?
==================================================
Translate the Five Forces analysis into economic reality.

Answer directly:
- Why does this business earn good or bad returns?
- Which forces most influence pricing power?
- Which forces most influence margins?
- Which forces most influence capital intensity and required reinvestment?
- Which forces are most likely to worsen over the next 3-5 years?
- Which forces matter least?

If the company has multiple business lines, compare them explicitly:
- Which business line has the most favorable force structure?
- Which has the least favorable?
- Which is most defensible?
- Which is most exposed to commoditization?
- Which is most exposed to substitution or customer pressure?

==================================================
STEP 7: COMPANY-SPECIFIC POSITIONING VS INDUSTRY FORCES
==================================================
Separate industry structure from company execution.

For each business line, explain:
- whether the company is advantaged or disadvantaged relative to peers
- whether the company benefits from scale, brand, regulation, cost position, network effects, distribution, relationships, or switching costs
- whether those advantages are real and durable or temporary
- whether the company can outperform even in a difficult industry
- whether the company is under-positioned or well-positioned relative to the industry structure

==================================================
STEP 8: DIRECTION OF TRAVEL
==================================================
For each business line, discuss whether the Five Forces are:
- improving for the company
- worsening for the company
- or stable

Explain what is changing:
- consolidation
- technology disruption
- regulation
- new entrants
- customer concentration
- supplier dynamics
- capacity additions
- vertical integration
- macro / cyclical effects
- AI / software / digitization
- international competition

I want to know not just the current force structure, but whether the company's positioning is getting better or worse.

==================================================
STEP 9: FIVE FORCES VISUAL DIAGRAM
==================================================
At the end, draw a Porter's Five Forces diagram for:
1. the company overall
2. each major business line, if the company has multiple business lines

The diagram should place:
- "Rivalry Among Existing Competitors" in the center
- "Threat of New Entrants" at the top
- "Bargaining Power of Suppliers" on the left
- "Bargaining Power of Customers" on the right
- "Threat of Substitutes" at the bottom

For each force in the diagram, show:
- the force name
- the score (1-5)
- a short phrase explaining why the rating is deserved

Example style:
- Threat of New Entrants — 4/5
  High capital intensity, regulation, and scale barriers protect incumbents

- Bargaining Power of Customers — 2/5
  Large customers have leverage, pricing transparency is high, and switching costs are modest

If you cannot render an actual graphic, then create a clean text-based or ASCII version of the Five Forces diagram that is easy to read.

For each business line, make the diagram separate and clearly labeled.

==================================================
STEP 10: OUTPUT FORMAT
==================================================
Organize the output exactly like this:

1. Executive summary
2. Relevant market definition
3. Business line identification
4. Five Forces summary table for the whole company
5. Separate Five Forces deep dives for each business line
6. Business-line comparison table
7. Overall positioning assessment
8. Company-specific positioning vs the forces
9. What could change the force rankings
10. Five Forces visual diagram for the company overall
11. Five Forces visual diagram for each major business line
12. Bottom-line conclusion

==================================================
STEP 11: BOTTOM-LINE CONCLUSION
==================================================
End with:
A. one paragraph on the overall Five Forces profile of the company
B. one paragraph comparing the business lines
C. one paragraph on the biggest risks to positioning and industry economics
D. one paragraph on whether the company appears positioned better or worse than peers
E. a concise verdict:
- best business line
- weakest business line
- highest-rated force
- lowest-rated force
- overall positioning score
- confidence level in the analysis

==================================================
IMPORTANT RULES
==================================================
- Do not give me a textbook explanation of Porter's Five Forces
- Apply the framework specifically and concretely
- Avoid generic strategy jargon
- Use real evidence, not management platitudes
- If reported segments are too broad, redefine the business lines economically
- Distinguish structural forces from cyclical conditions
- Distinguish company positioning from the abstract strength of the force
- Be willing to say the industry structure is unfavorable even if recent results are good
- Be willing to say one business line is much better positioned than another
- Use tables where useful
- Use numbers where possible
- Call out uncertainty where appropriate
- The final diagrams must be clear enough that I can look at them and quickly understand why each force got its score

The goal is for me to come away knowing:
1. how favorable the industry structure is for the company
2. which forces help or hurt it most
3. how the force structure differs across business lines
4. why returns are good or bad
5. whether the company is positioned better or worse than peers`;
