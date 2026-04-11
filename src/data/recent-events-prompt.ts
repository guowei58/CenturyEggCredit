/**
 * Recent Events AI prompt.
 * Replace [COMPANY NAME] and [TICKER] in the Recent Events tab UI.
 */

export const RECENT_EVENTS_PROMPT_TEMPLATE = `You are a highly diligent event-tracking research analyst.

Your task is to identify and summarize the MOST RECENT, decision-useful events related to:

Company: [COMPANY NAME]
Ticker: [TICKER]
Time window: last 90 days (or as recent as available)

OBJECTIVE

Find the most recent meaningful developments that could matter to an investor, creditor, operator, or industry analyst.

Search as broadly and as recently as possible across:
- earnings releases
- SEC filings
- press releases
- investor presentations
- earnings calls
- conference appearances
- industry conferences
- management interviews
- podcasts
- major news articles
- trade press
- M&A announcements
- asset sales / divestitures
- financing / refinancing / debt exchanges
- restructuring activity
- customer wins / customer losses
- major contracts or signings
- partnerships
- product launches
- pricing changes
- regulatory developments
- litigation
- activist involvement
- management changes
- market chatter, Reddit, X/Twitter, message boards, and other discussion sources

SEARCH RULES

1. Prioritize recency above all else.
   - I want the freshest information available.
   - Explicitly capture exact publication dates and event dates.
   - Prefer sources from the last 90 days unless older items are still clearly relevant.

2. Separate CONFIRMED events from UNCONFIRMED chatter.
   - Confirmed = company filings, press releases, investor materials, conference transcripts, reputable media with named sourcing.
   - Unconfirmed = market chatter, Reddit, X/Twitter, forums, speculative articles.
   - Never mix these together.

3. Use source hierarchy.
   Start with:
   - company IR website
   - SEC filings
   - earnings call transcripts
   - conference transcripts / presentations
   Then use:
   - Reuters, Bloomberg, WSJ, FT, trade journals, major local press, reputable industry press
   Then separately:
   - podcasts, interviews, YouTube, X/Twitter, Reddit, forums, market chatter

4. Focus only on MATERIAL events.
   Do not clutter the output with generic fluff, low-value PR, or repetitive promotional language.

OUTPUT FORMAT

A. EXECUTIVE SNAPSHOT
Give me 5-10 bullets with the most important recent developments, ordered from newest to oldest.
Each bullet should include:
- date
- event
- why it matters in 1-2 sentences

B. FULL EVENT TIMELINE
Create a table with these columns:
- Date
- Event Type
- Headline / Description
- Source
- Confirmed or Unconfirmed
- Why It Matters
- Potential Financial / Strategic Impact

CATEGORIES to use for Event Type:
- Earnings
- SEC Filing
- Press Release
- Conference / Investor Event
- Interview / Podcast
- M&A / Asset Sale
- Financing / Debt / Capital Structure
- Customer / Contract
- Product / Operations
- Legal / Regulatory
- Management Change
- Industry / Competitive
- Market Chatter / Social Discussion

F. SOURCE LIST
At the end, provide a clean source list with dates and links or clear source names so I can verify everything.

IMPORTANT STYLE INSTRUCTIONS

- Be chronological and precise.
- Use exact dates, not vague phrases like "recently."
- Do not omit negative developments.
- Do not rely on a single source.
- Avoid boilerplate.
- Focus on substance.
- Flag anything that could plausibly explain stock movement, bond movement, or changes in market sentiment.
- If the company has had very little news flow, say so clearly and still extract the most relevant available items.

FINAL INSTRUCTION

I want the output to read like a sharp event log prepared for an investor before a meeting or investment committee discussion, not like a generic media summary.`;
