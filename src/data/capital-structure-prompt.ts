import { EXCEL_API_OUTPUT_FORMAT_SECTION } from "@/lib/excel-api-deliverable";

import { resolveCompanyPromptLabels } from "@/lib/company-prompt-labels";

/**
 * Capital Structure tab prompt.
 * The UI inserts the real ticker into the `{{TICKER}}` placeholder at runtime.
 */

/** Reference screenshots for the Capital Structure tab. */
export const CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS = [
  "/capital-structure-sample-1.png",
  "/capital-structure-sample-2.png",
] as const;

export const CAPITAL_STRUCTURE_PROMPT_TEMPLATE = `Build a WORKING EXCEL capital structure workbook for {{TICKER}}.

You are a highly experienced leveraged finance and distressed credit analyst. Your job is to create a detailed, analyst-quality capital structure workbook for the company identified by the ticker {{TICKER}}.

I may also provide:
- one or more example capital structure tables
- company filings
- debt documents
- earnings materials
- rating reports
- other source files

Your output must follow the example format as closely as possible, while adapting intelligently to the target company’s actual capital structure.

==================================================
CRITICAL — LATEST 10-K AND 10-Q (MANDATORY)
==================================================
You MUST locate and use {{TICKER}}’s **latest filed Form 10-K** and **latest filed Form 10-Q** as the primary factual basis for the workbook: pull reported debt balances, debt and liquidity footnotes, financing tables, definitions, entity names, and filing/reporting dates from those two documents above all else. Do not substitute stale filings, memory, or generic summaries when the current 10-K and 10-Q are available—**ground the capital structure in what the most recent 10-K and most recent 10-Q actually say**, and cite both clearly in your Sources tab (with filing period / date). If you cannot retrieve them, state that explicitly rather than inventing numbers.

==================================================
INPUTS
==================================================
Primary input:
- Ticker: {{TICKER}}

Optional additional inputs:
- Example capital structure files or screenshots
- 10-K / 10-Q / 8-K
- debt footnotes
- credit agreements
- bond indentures
- offering memoranda / exchange documents
- earnings presentations
- earnings call transcripts
- rating agency reports
- any manually supplied notes

Do NOT hardcode the ticker.
Always use {{TICKER}} as the target company ticker.

==================================================
PRIMARY OBJECTIVE
==================================================
Create a detailed capital structure workbook in Excel for {{TICKER}} that:
- follows my example tables as closely as possible
- shows as much detail as possible
- is useful for real credit underwriting
- includes formulas, notes, sources, and structural detail
- captures guarantors, collateral, and restricted vs unrestricted status

This should feel like a real buy-side / distressed credit analyst’s workbook, not a generic AI output.

==================================================
OUTPUT REQUIREMENT
==================================================
Produce a WORKING EXCEL FILE (.xlsx), not just a markdown table.

The workbook should be usable immediately and should contain properly formatted tabs, formulas, notes, and a source log.

Please include some commentary about the capital structure on a page in the Excel file called Notes. On this page, write a thoughtful summary of the information you've found.

At a minimum, create these tabs:
1. Capital Structure
2. Guarantor & Collateral Detail
3. Notes
4. Sources

Add these tabs if relevant:
5. Pro Forma Adjustments
6. Debt Detail
7. Market Data / Pricing
8. Maturity Schedule
9. Entity / Issuer Map

The Excel workbook should include:
- formulas for totals and subtotals
- formulas for gross debt
- formulas for net debt
- formulas for leverage metrics
- formulas for weighted average interest cost where possible
- formulas for market value calculations where prices are available
- clear labels for reported vs pro forma values
- clearly marked assumptions and estimated fields

Do not just dump static values into a spreadsheet if formulas are feasible.

==================================================
FOLLOW MY EXAMPLES
==================================================
If I provide example capital structure tables, use them as the template.

Match them as closely as possible in:
- layout
- column order
- row grouping
- subtotals
- indentation
- naming conventions
- formulas
- summary rows
- note style
- worksheet organization
- formatting density

If the example contains a column that is not directly disclosed for the target company, preserve those columns and fill them with:
- disclosed value
- estimated
- N/A
- not disclosed
as appropriate.

Do not silently drop columns from the example format.

==================================================
WHAT TO INCLUDE
==================================================
Show as much relevant detail as possible, including:
- revolver
- drawn and undrawn revolver amounts
- term loans
- secured debt
- unsecured debt
- senior notes
- senior secured notes
- subordinated debt
- holdco debt
- opco debt
- subsidiary debt
- ABS / securitization debt
- receivables facilities
- finance leases if relevant
- preferred stock / preferred equity if relevant
- converts / exchangeables
- PIK instruments
- hybrid securities
- seller notes / promissory notes if material
- project finance debt if relevant
- other material obligations that matter economically

If something is not technically debt under GAAP but matters economically for the capital structure, include it and label it clearly.

==================================================
REQUIRED DETAIL FOR EACH SECURITY
==================================================
For each security or debt instrument, show as much of the following as possible:

- Instrument name
- Issuer
- Borrower
- Guarantors
- Full guarantor list or guarantor summary
- Guarantor coverage notes
- Entity level
- Security / collateral
- Collateral package
- Key collateral exclusions
- Lien ranking
- Structural ranking
- Instrument type
- Currency
- Spread / coupon
- Fixed vs floating
- Reference rate
- Floor
- All-in yield if available
- Stated maturity
- Springing maturity if relevant
- Original issue amount
- Current face amount
- Current drawn amount
- Undrawn capacity
- Market price
- Market value
- Carrying value if relevant
- Annual cash interest
- PIK interest if relevant
- Mandatory amortization if relevant
- Call features / make-whole / prepayment terms if especially relevant
- Covenant package / maintenance covenant if relevant
- Secured vs unsecured
- Guaranteed vs nonguaranteed
- Recourse / non-recourse
- Restricted / unrestricted status
- Restricted group support
- Public vs private
- Ratings if available
- Ticker / CUSIP if relevant
- Maturity year / maturity bucket
- Notes / comments
- Material nonguarantor / unrestricted asset notes

Also include summary rows where relevant, such as:
- Total debt
- Total secured debt
- Total unsecured debt
- First lien debt
- Second lien debt
- Junior secured debt
- Debt at parent
- Debt at subsidiaries
- Debt at unrestricted subs
- Lease obligations
- Preferred equity
- Gross debt
- Cash
- Net debt
- LTM EBITDA
- Net leverage
- First lien leverage
- Secured leverage
- Senior secured leverage
- Other leverage metrics shown in my examples

==================================================
GUARANTOR / COLLATERAL / RESTRICTED STATUS REQUIREMENT
==================================================
For each security, show as much as can be determined from public filings and debt documents:

1. Guarantors
- full guarantor list
- if the full guarantor list is too long for the main table, provide:
  - a short summary in the main table, and
  - the full guarantor list in the “Guarantor & Collateral Detail” tab
- whether the instrument is guaranteed or nonguaranteed
- whether guarantees are upstream, downstream, cross-stream, limited, springing, or otherwise conditional
- whether guarantor coverage includes substantially all restricted subsidiaries or only a subset
- whether any material operating subsidiaries are excluded from the guarantor package
- whether nonguarantor subsidiaries appear to hold meaningful assets or EBITDA

2. Collateral
Show:
- collateral package
- whether the lien is first lien, second lien, junior lien, unsecured, structurally senior, or separate / siloed
- what major assets are pledged, if disclosed
- whether collateral includes:
  - equity interests
  - ABL collateral
  - accounts receivable
  - inventory
  - cash
  - deposit accounts
  - equipment
  - intellectual property
  - real estate
  - licenses / spectrum / regulated assets if relevant
  - stock of subsidiaries
  - substantially all assets
- important exclusions from collateral, if disclosed
- whether collateral is shared with other facilities
- whether intercreditor or lien-sharing arrangements matter

3. Restricted / Unrestricted Status
Show:
- whether the issuer is in the restricted group or unrestricted group
- whether guarantors are restricted or unrestricted subsidiaries
- whether collateral sits in the restricted group or outside it
- whether the debt is structurally inside or outside the main credit box
- whether the instrument benefits from guarantees or collateral from unrestricted entities, if any
- whether there are material unrestricted subsidiaries that hold assets but do not support the debt

If any of the above cannot be determined with confidence, say:
- not disclosed
- unclear from available documents
- estimated
rather than guessing.

==================================================
CALCULATION RULES
==================================================
Where possible, calculate and show in Excel:
- gross debt
- net debt
- market value of debt
- weighted average cash interest cost
- leverage ratios
- debt maturity schedule summary
- secured vs unsecured mix
- fixed vs floating mix
- debt by entity level
- debt by lien
- debt supported by guarantors vs nonguaranteed debt

If EBITDA is needed:
- use LTM Adjusted EBITDA if clearly disclosed
- if not disclosed, use the closest reasonable EBITDA measure and label it clearly
- if multiple EBITDA figures exist, use the most credit-relevant one and explain alternatives in the Notes tab

If debt prices are unavailable:
- leave blank, mark N/A, or note not available
- do not invent prices

If a pro forma transaction materially changes the capital structure, show:
- reported
- adjustment
- pro forma

Use formulas where possible rather than hardcoded totals.

==================================================
MULTI-ENTITY / COMPLEX STRUCTURES
==================================================
If the company has:
- multiple issuer entities
- holdco / opco separation
- restricted vs unrestricted groups
- ABS / receivables financing
- foreign debt silos
- project finance
- non-guarantor debt
- structurally senior debt
- exchangeable or convertible instruments
- preferred or hybrid securities
- bankruptcy-remote vehicles
- debt at JVs or partially owned subs

reflect those clearly in the spreadsheet and notes.

Do not oversimplify a messy structure.

==================================================
GUARANTOR & COLLATERAL DETAIL TAB REQUIREMENT
==================================================
The workbook must include a dedicated “Guarantor & Collateral Detail” tab that maps each security to:
- instrument name
- issuer / borrower
- guarantor summary
- full guarantor list where available
- guarantor coverage notes
- collateral package
- key collateral exclusions
- lien ranking
- structural ranking
- restricted / unrestricted status
- restricted group support
- material exclusions, carveouts, or limitations
- source support for each conclusion

This tab should let me quickly understand which securities are actually supported by which entities and assets.

==================================================
EXCEL FORMATTING REQUIREMENTS
==================================================
Make the Excel workbook professional and easy to use.

Formatting requirements:
- freeze top row
- bold header row
- consistent number formatting
- percentage formatting where needed
- currency formatting where needed
- clear shading for subtotal and total rows
- separate sections for debt buckets
- footnote references where appropriate
- widths adjusted so the sheet is readable
- formulas visible in cells, not embedded in comments only
- no broken links or placeholder text
- preserve the visual logic of my examples as closely as possible

If possible, use standard analyst-friendly color coding for:
- hardcoded inputs
- formulas
- linked / derived values

==================================================
NOTES TAB
==================================================
Include a Notes tab that clearly states:
- a thoughtful summary of the capital structure and the information you've found
- reporting date used
- pro forma adjustments
- EBITDA definition used
- net debt calculation
- key structural-subordination issues
- guarantor / nonguaranteed issues
- restricted / unrestricted group assumptions
- collateral limitations
- assumptions / estimates
- missing data fields
- open diligence questions

==================================================
SOURCES TAB
==================================================
Include a Sources tab showing the key source used for each major debt instrument or calculation.

For each source entry, include where possible:
- document name
- date
- instrument or issue supported
- what the source confirms
- page / section reference if available

==================================================
${EXCEL_API_OUTPUT_FORMAT_SECTION}

==================================================
IMPORTANT RULES
==================================================
- always use {{TICKER}} as the target company ticker
- follow my examples closely
- preserve the example structure even if some fields are unavailable
- if a column cannot be populated, leave it as N/A or not disclosed rather than dropping it
- show as much relevant detail as possible
- distinguish reported numbers from estimates
- distinguish quarter-end from pro forma
- distinguish face value from market value
- distinguish gross debt from net debt
- preserve capital structure hierarchy and entity placement where relevant
- do not guess when the answer is unclear
- do not stop at headline debt balances; show the structural support for each security
- the final output must be a working Excel spreadsheet delivered as base64 per the output format above

The final deliverable should feel like a real analyst-built capital structure workbook for {{TICKER}}, prepared for credit underwriting.

==================================================
REFERENCE SAMPLE IMAGES (attach with this prompt in vision-capable tools)
==================================================
[SAMPLE_IMAGE_URLS]
`;

function capitalStructureSampleImageUrlsBlock(appOrigin: string): string {
  const origin = appOrigin.trim();
  return !origin
    ? CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS.map(
        (p, i) =>
          `${i + 1}. After you open this app in a browser, use: <your app URL>${p}`
      ).join("\n")
    : CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS.map((p, i) => `${i + 1}. ${origin}${p}`).join("\n");
}

/** Apply ticker and sample-image URL block (same pattern as org-chart). */
export function resolveCapitalStructurePrompt(params: {
  template: string;
  ticker: string;
  companyName?: string | null;
  appOrigin: string;
}): string {
  const safeTicker = params.ticker.trim();
  if (!safeTicker) return "";
  const { tickerForPrompt } = resolveCompanyPromptLabels({
    workspaceKey: safeTicker,
    companyName: params.companyName,
  });
  const urls = capitalStructureSampleImageUrlsBlock(params.appOrigin);
  return params.template
    .replace(/\{\{TICKER\}\}/g, tickerForPrompt)
    .replace(/\[SAMPLE_IMAGE_URLS\]/g, urls);
}

