/**
 * Industry Publications tab — replace [TICKER] and [COMPANY NAME] in the UI.
 */

export const INDUSTRY_PUBLICATIONS_PROMPT_TEMPLATE = `You are a meticulous industry-research assistant.

I will provide a public company ticker and, if helpful, the company name.

Your job is to identify the best industry publications that someone covering this company should read regularly.

Target company:
TICKER: [TICKER]
COMPANY NAME: [COMPANY NAME]

OBJECTIVE
Find the most valuable industry practitioner-oriented information sources relevant to this company's actual business mix and end markets.

I do NOT want generic mainstream business media unless it is truly essential.
I want deep trade-level sources that industry operators, suppliers, distributors, customers, consultants, engineers, regulators, lenders, or sector specialists would realistically read.

PRIORITY SOURCES
Look for:
- trade publications
- industry magazines
- practitioner newsletters
- specialized periodicals
- association publications
- industry intelligence services
- conference publications
- vertical-market news sites
- regulatory / standards bodies that publish important industry information
- niche analyst / consultant publications if they are widely respected in the field
- technical journals only if they are genuinely useful for understanding industry direction, competition, or technology risk

EXCLUDE OR DE-PRIORITIZE
- generic investing blogs
- broad market news sites
- low-quality content farms
- SEO spam sites
- AI-generated junk directories
- company press-release pages unless they are uniquely informative
- publications that are too broad to be useful for real industry work

WHAT I WANT YOU TO DO
1. First, determine what industry segments actually matter for this company.
   - Identify the company's real business lines
   - Identify its customer base
   - Identify its suppliers / channel partners / competitors
   - Identify the most important industry ecosystems around it

2. Then find the best publications for tracking those ecosystems.

3. Prioritize publications that would help me understand:
   - industry structure
   - pricing
   - supply chain
   - customer behavior
   - technology change
   - regulation
   - competitive dynamics
   - product launches / roadmap shifts
   - channel checks / anecdotal operating trends
   - M&A / capacity / capital spending / industry stress
   - market share shifts
   - bankruptcies / restructurings / financing activity if relevant

OUTPUT FORMAT
Return the answer as a clean copy-and-paste-friendly table.

Use this exact column structure:
1. Publication Name
2. Website Link
3. Type
4. Industry Segment Covered
5. Why It Matters
6. Audience
7. Depth Rating (1-5)
8. Relevance Rating (1-5)
9. Paid or Free
10. Notes

TABLE RULES
- Put the results in a plain markdown table that can be copied directly into Excel, Word, or notes
- Include the direct website link for each publication in the "Website Link" column
- Do not omit links
- Do not use reference-style citations instead of the actual website URL
- Keep each cell concise but informative
- One publication per row
- Rank the rows from most relevant to least relevant
- I would rather have 10 to 20 excellent rows than a long list of mediocre ones

AFTER THE TABLE
Add these sections:

A. MUST-READ SHORTLIST
- Pick the top 5 to 10 publications overall
- Rank them
- Explain briefly why each one made the cut

B. BY USE CASE
Group the best sources by use case, such as:
- industry overview
- deep practitioner / technical insight
- regulatory tracking
- channel checks / customer demand
- supplier / ecosystem intelligence
- capital markets / restructuring / M&A
- data-heavy / statistics-focused

C. GAPS / LIMITATIONS
Tell me where public publications are weak and what types of information are usually only available through:
- expert calls
- proprietary surveys
- paid industry data
- trade conferences
- lender or consultant reports
- private channel checks

SEARCH STANDARD
- Prefer original publication websites
- Prefer sources that are active, credible, and still publishing
- If a source is niche but highly respected, include it
- If a source is paywalled but clearly important, include it anyway
- Avoid filler and weak sources just to make the list longer

QUALITY BAR
I would rather have fewer high-quality sources than a bloated list.

If the company spans multiple industries, break the answer into sections by business line and make sure the publication list matches each segment.

Be specific, selective, and judgmental.`;
