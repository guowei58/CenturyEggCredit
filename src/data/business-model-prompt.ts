/**
 * Credit-analyst business model deep-dive prompt for the Business Model tab.
 * Replace [TICKER / COMPANY NAME] in the UI with actual ticker and display name.
 */
export const BUSINESS_MODEL_PROMPT_TEMPLATE = `You are a highly experienced credit analyst. I want you to help me deeply understand the business model of [TICKER / COMPANY NAME] like an investor underwriting the credit.

Your job is not to give me a generic company overview. Your job is to explain, in plain English but with analytical rigor, what makes this company's business actually work, how it makes money, why returns are good or bad, and what causes the business to strengthen or deteriorate over time.

Use a credit analyst mindset:
- focus on business quality, durability of cash flow, cyclicality, margin structure, capital intensity, working capital needs, customer concentration, competitive dynamics, and downside risk
- explain not just what the company says, but what economically drives the business
- separate accounting presentation from economic reality
- identify what matters most for debt holders, not just equity holders

Use the most relevant primary sources available, prioritizing:
1. latest 10-K
2. latest 10-Q
3. latest earnings call transcript
4. investor presentation / investor day materials
5. proxy if useful for incentives and segment definitions
6. rating agency reports if available
7. industry sources only where needed to clarify economics

If information is missing or uncertain, say so clearly. Do not make things up.

I want the analysis organized in the following way:

--------------------------------------------------
1. EXECUTIVE SUMMARY
--------------------------------------------------
Start with a concise but insightful summary covering:
- what the company actually does
- how it makes money
- the key variables that determine whether it earns good or bad returns
- the most important business lines
- what a credit investor should worry about most
- what makes the business simple or difficult to underwrite

Answer this directly:
"What makes this business tick?"

--------------------------------------------------
2. WHAT THE COMPANY SELLS
--------------------------------------------------
Explain:
- what products and services the company sells
- who the customers are
- who makes the buying decision
- whether demand is recurring, transactional, contractual, cyclical, or discretionary
- whether the company is selling a mission-critical product, a commodity, a convenience, or a luxury
- whether the company is primarily selling a product, a service, access, distribution, financing, software, infrastructure, or some bundled combination

Do not stop at management's labels. Translate the business into economic reality.

--------------------------------------------------
3. HOW THE COMPANY MAKES MONEY
--------------------------------------------------
Break down the economic model clearly.

For the company as a whole, explain:
- what drives revenue
- what drives gross profit / contribution margin
- what drives EBITDA and free cash flow
- whether the company benefits more from price, volume, mix, utilization, spread, take rate, subscriptions, advertising, financing spread, asset turns, or operating leverage
- whether profits are driven by fixed-cost absorption, scale, scarcity, switching costs, regulation, brand, distribution, or customer captivity

Show the money-making logic in a simple way, such as:
Revenue = price × volume
or
Revenue = customers × ARPU
or
Revenue = assets × yield – funding cost – losses
or
Revenue = units sold × gross margin – SG&A – maintenance capex

I want the "economic engine" stated explicitly.

--------------------------------------------------
4. BUSINESS LINES / SEGMENTS
--------------------------------------------------
If the company has multiple business lines, do NOT just repeat reported segments mechanically.

Instead:
- identify each economically distinct business line
- explain what each business line sells
- who the customers are
- what drives revenue and margins in that business line
- how cyclical / recurring / capital intensive it is
- whether it is a good business or a bad business
- whether it earns high returns because of real advantages or just temporarily favorable conditions
- whether management's segment reporting hides important differences

For each business line, provide:
A. Business description
B. Customer base
C. Revenue model
D. Cost structure
E. Capital intensity
F. Working capital profile
G. Margin / return drivers
H. Competitive position
I. Key risks
J. Credit relevance

If possible, estimate or summarize each business line's contribution to:
- revenue
- EBITDA or operating profit
- cash flow
- asset intensity
- strategic importance

Clearly distinguish:
- crown jewel assets
- stable cash flow businesses
- cyclical businesses
- melting ice cubes
- turnaround / challenged segments
- segments that consume capital but do not earn enough return

--------------------------------------------------
5. UNIT ECONOMICS AND VALUE CREATION
--------------------------------------------------
Help me understand why this business earns the returns it does.

Answer:
- what are the true unit economics?
- what is the key "unit" of analysis? (customer, subscriber, store, route, bed, tower, loan, ton, seat, contract, location, shipment, etc.)
- what does a good unit look like economically?
- what has to go right for the company to earn attractive returns?
- what usually causes returns to deteriorate?

Discuss:
- pricing power vs price taking
- utilization / occupancy / throughput / capacity use
- customer acquisition cost, retention, churn, and lifetime value if relevant
- gross margin structure
- fixed vs variable costs
- operating leverage
- asset turns
- required reinvestment
- maintenance vs growth capex
- working capital drag or benefit
- whether reported earnings overstate or understate true economics

I want a direct answer to:
"Why is this a good business, or why is it not?"

--------------------------------------------------
6. WHAT DRIVES GOOD VS BAD RETURNS
--------------------------------------------------
Give me a detailed framework for what causes this company to earn:
- good returns on capital
- mediocre returns
- poor returns / value destruction

Be specific. Break this into the actual drivers, such as:
- favorable / unfavorable industry structure
- capacity discipline or oversupply
- commodity exposure
- labor intensity
- procurement power
- channel power
- scale economics
- utilization rates
- regulation
- underwriting discipline
- loss rates
- maintenance burden
- product obsolescence
- customer churn
- mix shift
- capital allocation
- acquisitions
- technology change

Separate:
- structural drivers
- cyclical drivers
- management-execution drivers
- accounting distortions

--------------------------------------------------
7. COMPETITIVE DYNAMICS AND INDUSTRY STRUCTURE
--------------------------------------------------
Explain:
- who the real competitors are
- how competition actually works in this industry
- what customers care about most when choosing a provider
- whether competition is based on price, service, speed, reliability, scale, location, regulation, brand, innovation, or relationships
- whether the industry is rational or irrational
- whether the market structure supports good returns
- whether barriers to entry are real or overstated
- whether substitutes are emerging

Answer:
- what is the company's moat, if any?
- what keeps competitors from taking the economics away?
- if returns are high, why haven't they been competed down?
- if returns are low, why can't the company fix them?

--------------------------------------------------
8. CASH FLOW QUALITY
--------------------------------------------------
Analyze the difference between:
- revenue
- EBITDA
- EBIT
- free cash flow

Explain:
- how much of EBITDA converts to cash over a cycle
- what consumes cash beneath EBITDA
- whether the company has hidden cash drains
- whether working capital is a source or use of cash
- whether capex is understated or economically unavoidable
- whether restructuring, litigation, claims, maintenance, environmental, content, repossession, servicing, or technology spending are recurring even if labeled non-recurring

As a credit analyst, I care about:
- durability of cash generation
- downside conversion of EBITDA into cash
- how ugly things get in a weak environment

--------------------------------------------------
9. MANAGEMENT, STRATEGY, AND INCENTIVES
--------------------------------------------------
Evaluate:
- what management says the business is
- whether that matches economic reality
- whether management allocates capital intelligently
- whether they are masking weak economics with acquisitions, adjustments, or storytelling
- whether compensation incentives encourage good underwriting and long-term returns or short-term EBITDA optics

Also explain:
- whether management's strategy is improving the business or just buying time
- whether reported segment changes, KPIs, or adjusted metrics obscure business quality

--------------------------------------------------
10. RED FLAGS
--------------------------------------------------
List the most important business-model red flags, such as:
- revenue growth with poor cash conversion
- low reported capital intensity but high real reinvestment needs
- margin gains driven by underinvestment
- customer concentration
- supplier concentration
- end-market fragility
- contract repricing risk
- commodity exposure
- regulatory risk
- weak competitive position disguised by temporary tailwinds
- acquisition dependence
- excessive complexity
- poor segment disclosure
- claims / litigation / environmental / warranty / recall / reimbursement / reimbursement-denial risk
- hidden leverage in JVs, receivables, guarantees, leases, inventory, reserves, or off-balance-sheet structures

I want the red flags framed in a way that matters for underwriting downside.

--------------------------------------------------
11. KEY QUESTIONS FOR UNDERWRITING
--------------------------------------------------
Give me the 10 to 15 most important questions I should answer next to truly understand this business from a credit perspective.

These should be the questions that would actually move an underwriting decision.

--------------------------------------------------
12. SIMPLE UNDERWRITING CONCLUSION
--------------------------------------------------
End with:
A. one paragraph on how this business really works
B. one paragraph on why it does or does not earn good returns
C. one paragraph on what would most likely impair the credit
D. a concise verdict:
   - high-quality / medium-quality / low-quality business model
   - stable / cyclical / structurally declining / turnaround
   - asset-light / asset-heavy
   - strong / average / weak cash-flow durability

--------------------------------------------------
IMPORTANT INSTRUCTIONS
--------------------------------------------------
- Write for a sophisticated credit investor, not a beginner, but keep the language clear and concrete
- Avoid generic consultant language
- Avoid simply summarizing management's narrative
- Distinguish reported segments from economically real business lines
- If the company has multiple business lines, spend real time on each one and compare them
- Show where the economics are good versus where they are weak
- Highlight what is misunderstood, hidden, or easy to miss
- Use tables where helpful, especially for segment-by-segment analysis
- Where possible, quantify the business model with actual numbers from filings
- If data is not available, explain what proxy or inference you are using
- Do not just describe the business; explain the economic logic of the business

The goal is for me to come away knowing:
1. how this company makes money
2. what really drives returns
3. which business lines matter most
4. what could cause the model to break
5. whether this is a business I can trust from a credit perspective`;
