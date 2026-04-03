/**
 * 20-year GAAP historical model prompt for the Historical Financial Statements tab.
 * Replace [COMPANY NAME] and [TICKER] in the UI.
 */

export const HISTORICAL_FINANCIALS_PROMPT_TEMPLATE = `Build a 20-year historical financial model for [TICKER] ([COMPANY NAME]) in Excel format.

Requirements:
- Show all 3 statements:
  - Income Statement
  - Balance Sheet
  - Cash Flow Statement
- Use the company's own reported financials from SEC filings / annual reports / 10-Qs.
- Match the company's presentation exactly:
  - same line items
  - same ordering
  - same subtotals
  - same naming
- Populate all 20 annual years. No blank years.
- Use older 10-Ks / 10-K/As / annual reports as needed to backfill missing years.
- For 2020-2025, also include quarterly results from 10-Qs.
- Present 2020-2025 in this format:
  1Q, 2Q, 3Q, 4Q, Full Year
- Derive 4Q carefully from official filings when necessary, and flag when derived.
- Use the latest 10-K format as the base annual format and the latest 10-Q format as the base quarterly format.
- If presentation changed over time, map older years into the latest format and clearly note any judgment.
- Use restated figures where applicable.
- Flag restatements, reclassifications, fiscal year changes, bankruptcy/emergence presentation changes, and non-disclosed items.
- Do not simplify or normalize the company's presentation.
- Do not rely primarily on third-party data providers.
- Use XBRL scraping when it improves extraction quality, but always reconcile to the actual filing presentation.
- Do not invent values.

Output:
- Excel workbook
- Separate tabs for annual statements, quarterly statements, and notes
- Rows = line items
- Columns = years / quarters
- Notes tab should explain sources, restatements, mappings, and any derived 4Q values

Do not stop until all required annual and quarterly periods are populated.`;
