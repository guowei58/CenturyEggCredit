/**
 * Earnings releases tab prompt.
 * UI replaces {{TICKER}} and {{COMPANY_NAME}} at runtime.
 */

export const EARNINGS_RELEASES_PROMPT_TEMPLATE = `You are a meticulous equity / credit research assistant.

Your task is to find the last 20 earnings releases for the company identified by this ticker:

TICKER: {{TICKER}}
COMPANY NAME (optional if known): {{COMPANY_NAME}}

I do NOT want a casual summary. I want a source-backed list of actual earnings releases, with working links only.

OBJECTIVE
Find the 20 most recent earnings releases issued by the company. These should primarily include:
- quarterly earnings releases
- annual / fourth quarter earnings releases
- interim results releases
- earnings announcements published on the company IR website
- earnings releases furnished or filed with the SEC
- press releases clearly tied to reported financial results

SEARCH ORDER / SOURCE PRIORITY
Search in this order:
1. company investor relations website
2. company website press release / news / financial results pages
3. SEC filings, especially:
   - 8-K
   - 10-Q
   - 10-K
   - 6-K for foreign issuers
   - exhibits attached to filings, especially press release exhibits
4. reputable financial news / press release aggregators only if the original source is unavailable

IMPORTANT RULES
- Do NOT give me dummy links.
- Do NOT invent URLs.
- Only return links you have actually verified exist.
- Prefer direct company-hosted releases when available.
- If a direct press release link is unavailable, give the exact SEC filing or company webpage where the release appears.
- Do not include earnings call transcripts unless they are attached to the earnings release and the release itself is clearly available.
- Do not include presentation decks unless they are part of the earnings release package; the focus here is the release itself.
- Avoid duplicate versions of the same release mirrored across multiple sites; use the best original source.
- If fewer than 20 verified earnings releases can be found, say so clearly and return only the verified ones.

WORKFLOW
1. Identify the company’s investor relations site and earnings / press release archive.
2. Collect all recent earnings releases from the company site.
3. Cross-check SEC filings for earnings-release exhibits or furnished press releases.
4. Fill any gaps using reputable backup sources only when the original source cannot be found.
5. Verify every link before including it.
6. Rank the results from most recent to oldest.
7. If a release date is ambiguous, use the best evidence available and note the uncertainty.

OUTPUT FORMAT
Return the answer in a table with these columns:

1. Date
2. Period Reported
   - e.g., Q1 2025, Q4/FY 2024, FY 2023
3. Title
4. Source
   - company IR
   - SEC filing
   - other
5. Filing / Release Context
   - e.g., 8-K dated [date], IR press release page, Results page
6. Verified Link
7. Notes

After the table, include:
A. A short section titled “Search Notes” explaining:
- where you found most of the releases
- whether the company has a dedicated earnings archive
- whether you had to rely on SEC exhibits
- whether fewer than 20 verified items were available

B. A short section titled “Missing / Not Found” listing:
- any expected releases you could not locate
- any gaps in the chronology
- whether the company’s archive appears incomplete

QUALITY BAR
This is a document retrieval task, not a brainstorming task.
Be precise.
Be conservative.
Only include releases that are real, recent, and verifiable.`;
