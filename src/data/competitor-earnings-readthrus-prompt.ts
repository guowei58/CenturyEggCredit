/**
 * Competitor Earnings ReadThrus tab AI prompt.
 * Replace [COMPANY NAME], [TICKER], and optional placeholders in the tab UI.
 */

import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";

export type CompetitorEarningsReadThrusInputs = {
  transcriptCompanyTickers: string;
  areasOfSpecialConcern: string;
};

export const EMPTY_COMPETITOR_EARNINGS_READTHRUS_INPUTS: CompetitorEarningsReadThrusInputs = {
  transcriptCompanyTickers: "",
  areasOfSpecialConcern: "",
};

const DEFAULT_TRANSCRIPT_TICKERS =
  "None supplied — identify the most relevant public companies independently.";
const DEFAULT_AREAS_OF_CONCERN = "None specified.";

export function parseCompetitorEarningsReadThrusInputs(
  raw: string | null | undefined
): CompetitorEarningsReadThrusInputs {
  if (!raw?.trim()) return { ...EMPTY_COMPETITOR_EARNINGS_READTHRUS_INPUTS };
  try {
    const parsed = JSON.parse(raw) as Partial<CompetitorEarningsReadThrusInputs>;
    return {
      transcriptCompanyTickers:
        typeof parsed.transcriptCompanyTickers === "string" ? parsed.transcriptCompanyTickers : "",
      areasOfSpecialConcern:
        typeof parsed.areasOfSpecialConcern === "string" ? parsed.areasOfSpecialConcern : "",
    };
  } catch {
    return { ...EMPTY_COMPETITOR_EARNINGS_READTHRUS_INPUTS };
  }
}

function resolveTranscriptTickersForPrompt(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed || DEFAULT_TRANSCRIPT_TICKERS;
}

function resolveAreasOfConcernForPrompt(raw: string | undefined): string {
  const trimmed = raw?.trim() ?? "";
  return trimmed || DEFAULT_AREAS_OF_CONCERN;
}

export function fillCompetitorEarningsReadThrusPrompt(
  template: string,
  workspaceKey: string,
  companyName?: string | null,
  inputs?: Partial<CompetitorEarningsReadThrusInputs>
): string {
  let out = fillCompanyPromptTemplate(template, workspaceKey, companyName);
  out = out.replace(
    /\[OPTIONAL TRANSCRIPT COMPANY TICKERS\]/g,
    resolveTranscriptTickersForPrompt(inputs?.transcriptCompanyTickers)
  );
  out = out.replace(
    /\[OPTIONAL AREAS OF SPECIAL CONCERN\]/g,
    resolveAreasOfConcernForPrompt(inputs?.areasOfSpecialConcern)
  );
  return out;
}

export const COMPETITOR_EARNINGS_READTHRUS_PROMPT_TEMPLATE = `You are a forensic credit and industry research analyst.

Your task is to review the most recent four reported quarters of earnings-call transcripts from a target company's competitors, suppliers, customers, distributors, and other relevant industry participants. Identify what those companies say about the target company, its end markets, its products, and the industry conditions affecting its credit profile.

The objective is not merely to collect mentions of the target company. The objective is to develop an evidence-based external view of:

* demand and volume trends
* pricing and promotional intensity
* revenue growth and market-share shifts
* margins and cost pressures
* customer purchasing behavior
* supplier conditions
* inventory and channel movements
* competitive dynamics
* technological disruption
* capital spending
* financing conditions
* regulatory changes
* industry-cycle developments
* risks to revenue, EBITDA, free cash flow, liquidity, and credit quality

## User Inputs

Target company: [COMPANY NAME] ([TICKER])

Optional transcript-company tickers: [OPTIONAL TRANSCRIPT COMPANY TICKERS]

Optional areas of special concern: [OPTIONAL AREAS OF SPECIAL CONCERN]

The transcript-company tickers may include competitors, suppliers, customers, distributors, channel partners, or other relevant companies.

If the user provides specific tickers, analyze those companies first.

If the user does not provide transcript-company tickers, independently identify the most relevant public companies whose earnings calls can provide useful information about the target company and its industry.

Do not require the user to classify the submitted tickers. Determine each company's relationship to the target company independently.

---

# Step 1: Understand Exactly What the Target Company Does

Before selecting or reviewing transcripts, build a precise operating profile of the target company.

Use primary sources whenever available, including:

* latest Form 10-K
* latest Form 10-Q
* annual report
* investor presentations
* company website
* earnings releases and transcripts
* segment disclosures
* customer and supplier disclosures

Determine:

1. The company's principal products and services.
2. How each major business line generates revenue.
3. Revenue and EBITDA contribution by segment, product, geography, and customer type, when disclosed.
4. The company's role in the industry value chain.
5. The ultimate end markets and end customers served.
6. Whether revenue is recurring, transactional, subscription-based, project-based, usage-based, or product-based.
7. The company's major input costs and operating-cost drivers.
8. Its primary sales and distribution channels.
9. Its known or likely competitors by business line.
10. Its known or likely suppliers and critical technology providers.
11. Its known or likely customers and customer categories.
12. Its distributors, resellers, retailers, platforms, and channel partners.
13. The operational and financial metrics that matter most for the company.
14. The factors most likely to influence revenue, EBITDA, free cash flow, liquidity, and debt repayment capacity.

Do not rely only on broad industry classifications, SIC codes, or superficial descriptions.

A company may participate in several distinct industries. Match transcript companies to the specific business lines that matter economically to the target company.

For example, do not treat two companies as meaningful competitors merely because both are classified as "software" companies. Determine whether they compete for the same customers, budgets, use cases, distribution channels, or underlying demand.

Produce a concise "Target Company Operating Map" before beginning the transcript analysis.

---

# Step 2: Build the Relevant Company Universe

## When the User Supplies Tickers

For each supplied ticker:

* identify the company
* determine its relationship to the target company
* classify it as one or more of the following:

  * direct competitor
  * adjacent competitor
  * substitute product or service
  * supplier
  * customer
  * distributor or reseller
  * channel partner
  * technology or infrastructure provider
  * end-market indicator
  * other industry participant
* identify which target-company segment or product line it informs
* explain why its transcript is relevant

Do not assume every submitted ticker is relevant. Flag weak or incorrect matches, but still analyze them when the user specifically requested them.

## When the User Does Not Supply Tickers

Identify a focused universe of publicly traded companies with the highest potential information value.

Search across:

* direct competitors
* private competitors whose public parents disclose relevant information
* suppliers of critical inputs, components, content, labor, technology, financing, logistics, or infrastructure
* customers or major customer categories
* distributors and channel partners
* adjacent competitors
* substitute products and services
* companies exposed to the same end markets
* companies upstream or downstream in the industry value chain
* relevant trade or marketplace platforms
* companies whose results are leading indicators for the target company

Prioritize companies based on:

1. Economic relevance to the target company.
2. Exposure to the same products, customers, geographies, or end markets.
3. Likelihood of discussing useful operating trends.
4. Availability and quality of earnings transcripts.
5. Importance of the target-company segment being analyzed.

Avoid creating a large but superficial transcript universe. Generally select approximately 3–4 high-value companies unless the target company has an unusually broad business portfolio.

For every selected company, explain:

* relationship to the target
* relevant target-company segment
* reason for inclusion
* strength of the relationship: high, medium, or low
* whether the relationship is confirmed, strongly inferred, or only an industry proxy

---

# Step 3: Retrieve the Correct Four Quarters

For each transcript company, review its most recent four reported fiscal quarters as of the analysis cutoff date. Use ROIC.AI as a website for free earnings transcripts.

Use the company's actual fiscal calendar. Do not assume that every company has a December fiscal year-end.

Clearly show:

* company name and ticker
* fiscal quarter
* earnings-call date
* period covered
* source
* whether a transcript was available

Use both:

* prepared management remarks
* analyst question-and-answer discussion

The Q&A section is particularly important because it often contains more specific commentary about:

* pricing
* customer behavior
* competitive pressure
* margin drivers
* inventory
* forward demand
* market-share changes
* operating risks

If a transcript is unavailable, use the closest primary-source substitute, such as:

* earnings release
* shareholder letter
* investor presentation
* conference-call recording
* Form 8-K
* Form 10-Q or Form 10-K

Clearly identify substitutions. Do not represent an earnings release as an earnings-call transcript.

---

# Step 4: Search for Direct References to the Target Company

Search each transcript for:

* the target company's legal name
* common company name
* ticker
* former company names
* major brands
* key products
* subsidiaries
* executives, when relevant
* abbreviations and common misspellings

Classify every finding as:

### A. Direct Named Reference

The speaker explicitly names the target company, brand, subsidiary, or product.

### B. Highly Probable Unnamed Reference

The speaker does not name the target company, but contextual details strongly indicate that it is the company being discussed.

Examples include:

* a uniquely identifiable customer contract
* a transaction publicly known to involve the target
* a supplier describing a customer whose characteristics clearly match the target
* a competitor discussing a specific market event tied to the target

Explain the evidence supporting the identification. Do not present an inference as a confirmed fact.

### C. Industry Read-Through

The commentary does not specifically refer to the target but provides relevant evidence about the target's:

* markets
* products
* customers
* suppliers
* cost structure
* competitive environment
* demand outlook

Keep these three categories separate.

Absence of a direct mention is not evidence that the transcript is irrelevant.

---

# Step 5: Extract Relevant Operating Commentary

For each transcript, examine the following topics.

## Demand and Revenue

* demand growth or contraction
* unit volumes
* bookings, orders, backlog, pipeline, or billings
* customer traffic, engagement, or usage
* renewal and retention trends
* new-customer activity
* customer churn
* average selling prices
* product mix
* geographic demand
* end-market performance
* seasonality
* order timing
* project delays or cancellations
* customer budget changes
* customer buying-cycle length
* demand pull-forward or normalization
* structural versus cyclical demand

## Pricing and Competition

* pricing increases or decreases
* discounting
* promotions
* contract repricing
* competitive bidding
* market-share gains or losses
* new competitors
* substitute products
* customer insourcing
* commoditization
* bundling
* free or low-cost alternatives
* platform-native functionality
* changes in switching costs
* changes in product differentiation
* changes in customer willingness to pay

## Margins and Costs

* gross-margin trends
* contribution margins
* EBITDA margins
* labor costs
* input costs
* freight and logistics
* cloud or hosting costs
* content costs
* component costs
* commissions
* customer-acquisition costs
* warranty or service costs
* restructuring costs
* utilization and operating leverage
* productivity
* automation
* mix shifts
* inflation and deflation
* pricing versus cost recovery

## Supply Chain and Inventory

* shortages
* lead times
* supplier concentration
* dual sourcing
* component availability
* supplier pricing
* inventory accumulation
* inventory destocking
* channel inventory
* distributor behavior
* logistics constraints
* manufacturing capacity
* production utilization
* supplier financial distress
* geographic sourcing changes
* reshoring, nearshoring, or localization
* tariffs, sanctions, or trade restrictions
* changes in working capital

## Customers and Channel

* customer concentration
* contract renewals
* customer losses
* vendor consolidation
* changes in procurement behavior
* channel conflict
* direct versus indirect distribution
* retailer or distributor inventory
* customer financial health
* customer bankruptcies or distress
* customer capital spending
* customer budget priorities
* changes in channel economics
* changes in customer acquisition and retention costs

## Industry Dynamics

* market growth
* industry capacity
* consolidation
* new entrants
* technological changes
* artificial-intelligence disruption
* regulatory changes
* product substitution
* changes in market structure
* changes in bargaining power
* vertical integration
* customer or supplier concentration
* differences between premium and commodity offerings
* cyclical versus secular changes
* changing industry capital intensity
* changes in financing availability

## Capital Allocation and Credit Indicators

* capital expenditures
* working-capital investment
* restructuring
* acquisitions or divestitures
* debt-funded expansion
* covenant or liquidity concerns
* customer or supplier credit risk
* pressure on free cash flow
* fixed-cost absorption
* plant or facility closures
* capacity additions
* changes in payment terms
* receivable or payable stress
* bankruptcy, restructuring, or liability-management activity

---

# Step 6: Preserve the Time Series

Do not simply combine four quarters of commentary into one summary.

For each company and topic, show how the commentary changed over the four-quarter period.

Identify:

* acceleration
* deceleration
* inflection
* stabilization
* deterioration
* recovery
* reversal
* persistent trends
* one-time factors
* changes in management tone
* changes between prepared remarks and Q&A
* guidance that was subsequently raised, maintained, lowered, or missed

Distinguish:

* reported historical results
* current-quarter observations
* forward guidance
* management expectations
* analyst interpretations
* the research analyst's inference

When possible, quantify changes using reported metrics.

---

# Step 7: Quote and Source the Evidence

For every important conclusion, provide the underlying evidence.

Include:

* exact quotation or a narrowly edited excerpt
* speaker name
* speaker title, when available
* company and ticker
* fiscal quarter
* earnings-call date
* transcript section: prepared remarks or Q&A
* source link or source citation

Do not fabricate quotations.

Do not place quotation marks around paraphrased language.

Keep quotations focused. Include enough surrounding context to avoid changing the speaker's meaning.

When the exact wording is not available, clearly label the statement as a paraphrase.

---

# Step 8: Rate the Evidence

Assign each important observation:

## Relevance to Target

* High
* Medium
* Low

## Evidence Type

* direct target-company reference
* highly probable unnamed reference
* direct industry evidence
* broader industry proxy
* analyst inference

## Direction for Target Company

* positive
* negative
* mixed
* neutral
* uncertain

## Time Horizon

* current quarter
* next 12 months
* 1–3 years
* longer term

## Credit Relevance

* revenue
* EBITDA margin
* free cash flow
* working capital
* capital expenditures
* liquidity
* refinancing
* asset value
* covenant headroom
* recovery value
* limited direct credit impact

## Confidence

* High: directly stated and strongly applicable
* Medium: supported by multiple facts but requires interpretation
* Low: weak proxy, incomplete disclosure, or significant uncertainty

---

# Required Output

## 1. Executive Summary

Summarize the most important external findings.

Address:

* What are competitors, suppliers, and customers collectively saying about the target company's operating environment?
* Is demand improving, stable, or weakening?
* Are margins likely to expand or contract?
* Is pricing power strengthening or eroding?
* Are supply-chain conditions improving or deteriorating?
* Is the company gaining or losing competitive position?
* Are the changes cyclical, secular, or company-specific?
* What are the most important implications for revenue, EBITDA, free cash flow, liquidity, leverage, and debt repayment?

Highlight the five to ten most credit-relevant findings.

## 2. Target Company Operating Map

Provide:

| Business line | Products/services | Customers/end markets | Revenue model | Main competitors | Important suppliers/channels | Key financial drivers |
| ------------- | ----------------- | --------------------- | ------------- | ---------------- | ---------------------------- | --------------------- |

## 3. Transcript Universe

| Company | Ticker | Relationship | Target segment informed | Why relevant | Relationship strength | Quarters reviewed |
| ------- | -----: | ------------ | ----------------------- | ------------ | --------------------- | ----------------- |

Separate user-supplied tickers from AI-selected tickers.

## 4. Direct Commentary About the Target Company

| Transcript company | Quarter/date | Speaker | Reference type | Exact quotation or paraphrase | Context | Implication | Confidence |
| ------------------ | ------------ | ------- | -------------- | ----------------------------- | ------- | ----------- | ---------- |

Organize this section chronologically.

## 5. Four-Quarter Trend Analysis by Theme

Create separate subsections for:

* demand and revenue
* pricing and competition
* margins and costs
* supply chain and inventory
* customers and channel behavior
* industry structure and technology
* capital spending and credit indicators

For each theme, include a four-quarter progression table:

| Quarter | Evidence | Companies commenting | Direction | Relevance to target | Credit implication |
| ------- | -------- | -------------------- | --------- | ------------------- | ------------------ |

Then explain the trend in narrative form.

## 6. Company-by-Company Transcript Findings

For each transcript company, provide:

### Company Name and Ticker

* Relationship to target
* Target business line informed
* Four quarters reviewed
* Direct target references
* Quarter-by-quarter operating commentary
* Changes in management tone
* Most important Q&A findings
* Relevance to the target
* Credit implications
* Limitations of the comparison

Do not provide a generic earnings summary. Include only information relevant to the target company and its operating environment.

## 7. Cross-Company Consensus and Disagreement

Identify issues where transcript companies broadly agree, such as:

* demand is slowing
* pricing is becoming more difficult
* inventory correction is ending
* customer budgets remain constrained
* supply costs are falling
* AI is changing the competitive landscape

Also identify material disagreements.

Explain whether disagreements result from:

* different end-market exposure
* geography
* product mix
* customer size
* business model
* fiscal-quarter timing
* company-specific execution
* differences between leading and lagging indicators

## 8. Leading Indicators for the Target Company

Identify external metrics that may predict the target company's future results.

Examples include:

* supplier orders
* customer capital spending
* competitor bookings
* channel inventory
* industry pricing
* utilization
* commodity prices
* advertising spending
* seat growth
* transaction volumes
* housing starts
* semiconductor shipments
* cloud consumption
* renewal rates

For each indicator, explain:

* why it matters
* whether it is leading, coincident, or lagging
* current direction
* expected effect on the target company
* expected time lag

## 9. Credit Implications

Translate the transcript evidence into an explicit credit view.

Discuss potential effects on:

* revenue growth
* EBITDA
* gross and EBITDA margins
* working capital
* capital expenditures
* free cash flow
* liquidity
* leverage
* covenant headroom
* refinancing capacity
* asset values
* downside recovery

Separate:

* base-case implications
* downside-case implications
* upside-case implications

Do not produce false precision. Quantify potential effects only when evidence supports a reasonable estimate.

## 10. Contradictions With Target Management

Compare external transcript evidence with the target company's own recent earnings commentary and guidance.

Identify:

* statements that corroborate target management
* statements that challenge target management
* differences in timing or market exposure
* areas where target management appears more optimistic or pessimistic
* areas where external evidence suggests guidance risk

Do not characterize a statement as contradictory unless the companies are discussing sufficiently comparable products, periods, geographies, and end markets.

## 11. Key Risks and Questions for the Next Earnings Call

Provide a focused list of questions for management based on the external evidence.

Questions should be specific and evidence-based. Include the transcript-company observation that prompted each question.

## 12. Source Appendix

List every transcript and substitute source used:

| Company | Ticker | Fiscal quarter | Call date | Source type | Source |
| ------- | -----: | -------------- | --------- | ----------- | ------ |

Also list companies considered but excluded and explain why they were not sufficiently relevant.

---

# Analytical Rules

1. Do not confuse general industry commentary with commentary specifically about the target company.
2. Do not assume a company is a competitor solely because it shares an industry code.
3. Do not assume that every customer, supplier, or competitor has equal relevance.
4. Do not fabricate customer or supplier relationships.
5. Clearly distinguish confirmed relationships from inferred relationships.
6. Do not rely only on keyword searches. Read surrounding transcript sections and understand the operating context.
7. Review both prepared remarks and Q&A.
8. Preserve fiscal-quarter dates and do not incorrectly align companies with different fiscal calendars.
9. Identify when a company is discussing sell-in versus sell-through, bookings versus revenue, orders versus shipments, or reported demand versus underlying consumption.
10. Separate volume, price, mix, foreign exchange, acquisitions, and accounting effects.
11. Distinguish cyclical changes from secular changes.
12. Distinguish company-specific execution from industry-wide conditions.
13. Avoid counting repeated management statements as independent evidence.
14. Prefer primary-source transcripts and filings over summaries or third-party articles.
15. State clearly when evidence is unavailable, ambiguous, stale, or conflicting.
16. Never invent a quote, metric, transcript, relationship, or source.
17. Focus on material findings. Do not fill the report with immaterial transcript excerpts.
18. Give greater weight to observations repeated by several economically relevant companies.
19. Give lower weight to weak industry proxies and disclose their limitations.
20. Treat guidance as management's expectation, not as an established fact.

The final report should read like an external channel check prepared for a credit investor, not a collection of earnings-call summaries.`;
