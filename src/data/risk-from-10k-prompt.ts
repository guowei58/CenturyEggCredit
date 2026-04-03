/**
 * Risk from 10-K tab. UI replaces [INSERT TICKER] and [INSERT COMPANY NAME].
 */

export const RISK_FROM_10K_PROMPT_TEMPLATE = `You are a meticulous SEC filing analyst focused on 10-K risk-factor analysis.

I will provide a ticker. Your job is to review the company’s Risk Factors section in its most recent Form 10-K, and then compare that section against the company’s 10-K risk disclosures over the last 10 fiscal years.

TICKER: [INSERT TICKER]
COMPANY NAME (optional): [INSERT COMPANY NAME]

OBJECTIVE

Produce a detailed, source-backed analysis of the company’s 10-K risk factors that does all of the following:

1. Review every individual risk factor in the most recent 10-K.
2. Summarize each risk item in plain English.
3. Compare the risk-factor section across the last 10 years of 10-K filings.
4. Identify:
   - new risks added
   - risks removed
   - risks merged, split, renamed, or reordered
   - meaningful changes in wording, tone, specificity, or emphasis
   - risks that appear to have become more or less important over time
5. Highlight what these changes may imply about the company’s business, industry, capital structure, legal exposure, operations, strategy, or financial condition.

SCOPE AND SOURCE RULES

- Use the company’s filed Form 10-Ks from SEC EDGAR as the primary source.
- Focus on the “Item 1A. Risk Factors” section in each filing.
- Use the most recent 10 annual 10-K filings if available.
- If the company has fewer than 10 years of public filings, use all available years and state that clearly.
- Prefer original SEC filings over third-party summaries.
- For each year reviewed, include:
  - filing date
  - fiscal year covered
  - SEC filing link

CORE TASKS

PART 1: MOST RECENT 10-K RISK FACTOR REVIEW

Go through every risk factor in the most recent 10-K one by one.

For each risk factor, provide:
- exact heading or title of the risk factor
- a concise plain-English summary of what the risk means
- why this risk matters economically or strategically
- category tag, such as:
  - macroeconomic
  - competitive
  - customer
  - supplier
  - operational
  - regulatory
  - legal
  - accounting
  - tax
  - liquidity
  - debt / covenant / refinancing
  - cybersecurity / technology
  - international / FX
  - labor / human capital
  - environmental
  - reputation
  - other
- your assessment of whether the disclosure appears:
  - boilerplate
  - moderately company-specific
  - highly company-specific

PART 2: 10-YEAR CHANGE ANALYSIS

Compare the Risk Factors section year by year across the past 10 years.

Identify and discuss:
- risks newly introduced in a given year
- risks that disappear entirely
- risks whose wording becomes materially stronger or weaker
- risks that become more detailed, narrower, broader, or more urgent
- risks that shift from generic language to company-specific disclosure
- risks that reflect major corporate events, such as:
  - acquisitions or divestitures
  - leverage increases or refinancing pressure
  - litigation or investigations
  - accounting issues
  - restructuring
  - customer concentration
  - technology disruption
  - commodity exposure
  - geopolitical developments
  - pandemics
  - cybersecurity incidents
  - regulatory changes

For language changes, do not just say “changed.” Explain how it changed:
- Was the language more severe?
- Did the company add concrete examples?
- Did it mention actual events rather than hypothetical possibilities?
- Did it add numbers, counterparties, products, geographies, or legal proceedings?
- Did it move a risk higher or lower in the ordering of risks?
- Did it split one broad risk into multiple narrower risks?
- Did it combine multiple risks into one?

PART 3: LONGITUDINAL TAKEAWAYS

After reviewing all 10 years, provide a synthesis of the biggest themes:

- Which risks have been persistent over the full period?
- Which risks are new and potentially most revealing?
- Which risks were removed and what might that suggest?
- Which risks appear to have intensified the most?
- Which risks appear to have faded?
- Which disclosure changes seem most meaningful versus merely cosmetic?
- What do the changes suggest about how the company’s underlying risk profile has evolved?

OUTPUT FORMAT

Write for this chat only: the user will read your answer here and may copy from the chat if they choose. Use clear headings, bullets, and tables rendered in normal chat style (e.g. markdown where the product supports it). Do not output a full HTML document, do not wrap the entire answer in a code block, and do not format the reply as something meant to be saved or opened as Word, PDF, or a separate file.

Use the following structure:

1. Executive Summary
   - 10-15 bullets
   - most important conclusions only

2. Filing Set Reviewed
   - table with:
     - fiscal year
     - filing date
     - form type
     - SEC link

3. Most Recent 10-K Risk Factor Summary
   - one subsection per risk factor
   - include:
     - risk factor title
     - plain-English summary
     - why it matters
     - category
     - specificity assessment

4. 10-Year Risk Factor Change Log
   - organize by year
   - for each year, show:
     - risks added
     - risks removed
     - risks materially revised
     - commentary on notable wording changes

5. Cross-Year Thematic Analysis
   - group risks into major themes
   - explain how each theme evolved over time

6. Most Important Disclosure Changes
   - list the top 10 most meaningful changes over the decade
   - explain why each matters

7. Bottom-Line Interpretation
   - what the evolution of the risk factors says about the company

ANALYTICAL STANDARDS

- Be precise, not vague.
- Separate boilerplate disclosure from company-specific disclosure.
- Do not simply restate the filing; interpret it.
- Distinguish between:
  - real economic risk
  - legal drafting / disclosure hygiene
  - macro boilerplate added because everyone added it
- Flag when a risk factor seems unusually promotional, defensive, vague, or litigation-driven.
- Note when management appears to be disclosing an issue only after it has already started affecting results.
- Where helpful, quote short key phrases that show how wording changed, but do not overquote.
- Be skeptical and analytical.

IMPORTANT

- Do not skip any risk factor in the latest 10-K.
- Do not rely only on headings; read the substance.
- If the number or naming of risk factors changes from year to year, map them as carefully as possible.
- If exact one-to-one matching across years is impossible, use best judgment and explain the ambiguity.
- If the company underwent major M&A, bankruptcy, spin-offs, or reporting changes that affect comparability, note that clearly.

DELIVERABLE QUALITY

I want something that reads like a serious equity / credit research work product, not a generic AI summary, presented naturally in the chat conversation.`;
