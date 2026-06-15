import { fillCompanyPromptTemplate } from "@/lib/company-prompt-labels";

/**
 * Forensic credit org-chart + Excel deliverable prompt for the Org Chart tab.
 * Replace [COMPANY NAME], [TICKER], and [SAMPLE_IMAGE_URLS] in the UI.
 */

/** Primary sample (Lumen-style black / yellow / green). Kept for backward compatibility. */
export const ORG_CHART_SAMPLE_IMAGE_PATH = "/org-chart-sample-lumen.png";

/** All reference screenshots served from /public (attach in vision-capable models). */
export const ORG_CHART_SAMPLE_IMAGE_PATHS = [
  "/org-chart-sample-lumen.png",
  "/org-chart-sample-echostar.png",
  "/org-chart-sample-optimum.png",
] as const;

export const ORG_CHART_PROMPT_TEMPLATE = `You are a forensic credit analyst, corporate-structure mapper, regulatory filing hunter, and Excel diagram builder.

Your task is to create a credit-relevant corporate organizational structure chart for [COMPANY NAME] ([TICKER]) using the ATTACHED JPEG SAMPLE as the direct visual reference.

I want a buy-side / distressed-credit-quality deliverable that shows the legal and financing structure in a way that is actually useful for underwriting.

I want two things:
1. the analytical work to identify the important entities, reporting channels, and ownership relationships
2. the final organizational chart produced as an EXCEL FILE (.xlsx), laid out on a worksheet using **merged and shaded Excel cells** (not shapes or drawing objects) so that it visually resembles the attached JPEG sample as closely as practical

==================================================
CRITICAL — CELL-BASED CHART ONLY (NO SHAPES)
==================================================
Build the org chart using **only native worksheet cells** so it renders correctly in spreadsheet viewers that show cell data and formatting (not floating graphics).

REQUIRED approach:
- represent each entity "box" as a **merged cell range** with **solid fill color**, **borders**, and **text inside the cell**
- use **row/column placement** for top-down hierarchy (parent above children)
- use **borders, blank spacer rows/columns, and centered text in cells** to suggest ownership links and ownership percentages (e.g. "100%")
- use **wrap text**, **bold**, **font color**, **column width**, and **row height** for readability

DO NOT use (these will NOT display in our in-app Excel preview):
- Insert → Shapes / text boxes
- connector lines, elbow connectors, or SmartArt
- Excel Chart objects
- pasted images or floating graphics
- VBA / Office Script whose primary job is to draw shapes on the sheet

If you use openpyxl, xlsxwriter, or similar, set fills, borders, merges, alignment, and values on cells — do not add drawing objects.

Match the **visual logic** of the attached JPEG sample (black / yellow / green boxes, hierarchy, labels) using **cell formatting only**.

==================================================
PRIMARY OBJECTIVE
==================================================
Build a clean, one-page, credit-relevant organizational structure chart that includes all important operating and financing subsidiaries and clearly shows ownership relationships among them.

The chart should help a credit analyst quickly understand:
- where the operating business sits
- where major assets sit
- where cash flow and EBITDA sit, if disclosed or reasonably inferable
- where the debt sits
- which entities are issuers, co-issuers, guarantors, borrowers, financing vehicles, holding companies, and material opcos
- whether there are structural-subordination, ring-fencing, trapped-cash, or regulatory-separation issues
- which entities separately report or file public information that can be used to underwrite the structure

==================================================
REFERENCE SAMPLE IMAGES (attach with this prompt in vision-capable tools)
==================================================
Open or download each URL below and attach the image(s) together with this prompt. They are Excel-style credit org chart templates (PNG screenshots; treat as the JPEG reference requested).

[SAMPLE_IMAGE_URLS]

==================================================
USE THE ATTACHED JPEG SAMPLE AS THE VISUAL TEMPLATE
==================================================
Use the attached JPEG as the direct style and layout reference.

Match its visual logic as closely as practical, including:

1. Overall format
- one-page chart on the "Org Chart" worksheet
- top-down hierarchy using rows (parent higher on the sheet, children below)
- ultimate parent at the top
- direct subsidiaries shown beneath their parent in merged cell blocks
- ownership relationships shown with spacer rows/columns, border lines between levels, and ownership percentages in plain cells (e.g. "100%") — not shape connectors

2. Box style (cell fills — not shapes)
- default entity box: **merged cells** with dark / black **cell fill** and white **font**
- key financing / issuer / debt entities: **yellow cell fill** with black font
- core operating / cash-generating / asset-owning / regulated entities: **green cell fill** with white or black font, whichever is more readable
- outline each box with **cell borders** (thin or medium) on the merged range
- use color selectively to signal analytical importance, not decoration

3. Box content
For major entities, include:
- full legal entity name
- short descriptor in parentheses where useful, such as:
  - SEC filer
  - issuer
  - co-issuer
  - guarantor
  - financing sub
  - holdco
  - operating company
  - ILEC
  - regulated entity
  - national fiber owner
  - asset owner
  - legacy
  - shared services
  - unrestricted sub
- where available, include inside major boxes:
  - Cash: $X
  - Debt: $Y
  - Adj. EBITDA: $Z

For less important entities, include only:
- name
- short descriptor

4. Level of detail
- include important operating and financing subsidiaries
- do not include every immaterial subsidiary
- where needed, group minor entities into credit-relevant buckets such as:
  - Other operating subsidiaries
  - Other financing subsidiaries
  - Other regulated subsidiaries
  - Other international subsidiaries
  - Legacy subsidiaries
  - Shared services subsidiaries

5. Visual quality
The final chart should feel like a recreated version of the sample, adapted to the target company:
- similar placement logic (which entities sit left / center / right and above / below)
- similar visual density
- similar use of highlighted (shaded) cell boxes
- similar spacing using blank rows/columns between levels
- readable in one page at normal zoom
- presentation-ready without manual rearrangement after creation

==================================================
WHAT TO INCLUDE
==================================================
Include entities that are material or credit-relevant, including where applicable:
- ultimate parent
- public SEC filers
- major holdcos
- major opcos
- financing subsidiaries
- debt issuers
- co-issuers
- guarantor subsidiaries
- borrowers under credit facilities
- important asset-owning subsidiaries
- entities holding key operating licenses, networks, spectrum, fiber, brands, IP, real estate, receivables, customer contracts, regulated utility assets, or other major assets
- restricted subsidiaries
- unrestricted subsidiaries
- legacy / runoff / non-core subsidiaries if still relevant to liabilities, asset ownership, debt, guarantees, separateness, or value
- JV or partially owned entities only if material, with ownership percentages shown clearly
- entities that separately file, report, or appear in public regulatory / financing / securitization disclosures, even if they are not SEC registrants

Do NOT clutter the chart with immaterial local entities unless they matter for:
- collateral
- debt location
- guarantor structure
- bankruptcy remoteness
- regulation
- trapped cash
- asset ownership
- structural subordination
- securitization or ABS structures
- legacy liabilities
- tax or regulatory restrictions on cash movement

==================================================
SOURCE PRIORITY
==================================================
Use the most relevant primary sources, prioritizing:
1. latest 10-K
2. latest 10-Q
3. Exhibit 21 subsidiary list
4. debt indentures
5. credit agreements
6. guarantor footnotes / subsidiary guarantor disclosures
7. 8-K financing exhibits
8. investor presentations / investor day materials where helpful
9. rating agency reports only as supplemental support, not a substitute

Do not rely only on Exhibit 21.
Reconstruct the structure from a credit perspective, not merely a legal-listing perspective.

Where possible, use public source support to determine:
- legal ownership
- debt issuer / guarantor chains
- borrower entities
- asset ownership
- regulated entity status
- separate reporting entities
- cash / debt / EBITDA location
- financing silos
- restricted vs unrestricted treatment
- ring-fenced or bankruptcy-remote structures

If information is uncertain, say so clearly.
Do not invent entities, ownership links, reporting status, or financial data.

==================================================
ENTITY-LEVEL REPORTING / FILING HUNT
==================================================
In addition to identifying the legal structure, identify which material entities separately report financial, operating, regulatory, licensing, securitization, or other public information that may help a credit analyst understand the organization.

For each important entity, determine whether it files, reports, or is publicly referenced through any of the following:

1. SEC reporting
- parent company 10-K, 10-Q, 8-K, proxy
- subsidiary issuer filings
- subsidiary guarantor disclosures
- ABS / structured finance filings
- trust or financing vehicle filings
- registration statements
- indenture exhibits
- Exhibit 21 subsidiary lists

2. FCC / telecom / communications regulatory reporting
- FCC licenses
- FCC ownership reports
- FCC applications, renewals, transfers, assignments
- buildout / compliance filings
- spectrum, wireline, wireless, satellite, microwave, or related filings
- docket references or ex parte filings identifying ownership or asset location

3. State regulatory filings
- public utility commission filings
- insurance department filings
- rate cases
- annual statements
- statutory financials
- licensing records
- franchise / service territory / operating authority filings
- state-level registrations that help identify structure or asset ownership

4. Foreign regulatory filings
- foreign company registry filings
- foreign telecom / insurance / utility / banking filings
- local annual reports
- foreign licensing or regulatory disclosures
- cross-border subsidiary disclosures

5. ABS / financing / structured entities
- securitization trusts
- receivables SPVs
- warehouse facilities
- bankruptcy-remote entities
- project finance entities
- whole-business securitization entities
- leasing entities
- structured note issuers
- conduit or financing vehicles

6. Other public or quasi-public sources
- UCC filings where relevant
- FERC or other federal regulatory filings
- county / real estate / title records if material
- aircraft / rail / shipping / mineral / pipeline registries
- court filings
- bankruptcy dockets
- patent / trademark ownership records
- procurement / government contractor databases
- offering memoranda, trustee reports, exchange documents, or bond documents if publicly available
- rating agency entity-level references
- press releases or transaction documents that identify subsidiary roles

For each material entity, identify:
- whether it separately files or reports anything public
- what type of filing / reporting exists
- what those materials help confirm
- whether they may contain stand-alone financials, debt data, guarantor status, collateral info, asset ownership info, regulatory restrictions, or entity-level operating clues

Classify each entity where possible into one of these reporting buckets:
- SEC reporting entity
- regulatory reporting entity
- financing / ABS reporting entity
- foreign reporting entity
- non-reporting but publicly referenced entity
- no meaningful public reporting identified

==================================================
ANALYTICAL TASKS
==================================================
Before building the chart, do the following:

1. Identify the major legal entities
2. Classify each entity as one or more of:
   - parent
   - holdco
   - operating subsidiary
   - financing subsidiary
   - issuer
   - co-issuer
   - guarantor
   - borrower
   - asset owner
   - regulated entity
   - legacy / runoff
   - international
   - unrestricted
   - shared services
3. Determine direct ownership relationships
4. Determine ownership percentages where possible
5. Determine which entities should be shown individually
6. Group less important entities logically
7. Identify where debt sits versus where operating EBITDA sits
8. Identify structural-subordination, ring-fencing, trapped-cash, bankruptcy-remoteness, or regulatory-separation issues
9. Identify which entities separately report or file public information
10. Identify any mismatch between legal structure, financing structure, and economic reality

==================================================
EXCEL OUTPUT REQUIREMENT
==================================================
The final deliverable must be an Excel workbook (.xlsx).

Inside the workbook:
- create a worksheet named "Org Chart"
- create a worksheet named "Notes" with thoughtful commentary summarizing the org chart and the information you've found
- build the chart **only with worksheet cells** — merged ranges, fills, borders, fonts, alignment, column widths, and row heights
- each entity is a **merged cell block** containing the entity name and optional descriptor / metrics (Cash, Debt, Adj. EBITDA)
- show hierarchy top-to-bottom using row bands; align sibling entities across columns
- show ownership percentages in **plain cells** between parent and child (e.g. a centered "100%" in a row between levels), optionally with border lines on adjacent empty cells to suggest linkage
- size merged boxes and columns so the chart fits cleanly on one sheet
- keep the chart readable at normal zoom
- align the layout to resemble the attached JPEG sample as closely as practical using **cell layout only**
- make the chart presentation-ready with no manual rearrangement required after creation

Formatting requirements (all via cell styles):
- black fill with white font for standard entity boxes
- yellow fill with black font for key financing / issuer / debt boxes
- green fill with white or black font for core operating / key cash-generating / key asset-owning boxes, whichever is more readable
- consistent font size within the chart
- consistent border style on merged box ranges
- no shape objects, connector objects, chart objects, or embedded images on the Org Chart sheet

Please include some commentary about the org chart on a page in the Excel file called Notes. On this page, write a thoughtful summary of the information you've found.

The chart should visually answer at a glance:
1. what sits where
2. who owns whom
3. where the debt sits
4. where operating EBITDA sits
5. which entities are most important
6. whether there are structural ranking or separateness issues

==================================================
IF YOU CANNOT DIRECTLY CREATE THE EXCEL FILE
==================================================
If your environment cannot directly output a binary .xlsx file, then do ALL of the following:

1. produce Python code using openpyxl, xlsxwriter, or another suitable library to create the Excel workbook using **cell merges, fills, borders, fonts, and values only**

2. do **not** rely on VBA or Office Script to insert shapes or connectors; if you include helper code, it must only set cell properties (merge, fill, border, alignment, text)

3. include a precise placement map with:
- worksheet name
- each entity box: top-left cell, row/col span (merge size), fill color, font color, border style
- ownership label cells (row, column, text)
- spacer row/column plan
- column widths and row heights for major bands

Do not stop at a written analysis only.
The goal is a reproducible **cell-based** Excel chart that displays in standard spreadsheet previews.

==================================================
OUTPUT FORMAT
==================================================
Provide the answer in this order:

1. SHORT ENTITY MAP SUMMARY
Briefly explain:
- who the top parent is
- where the main operating business sits
- where the main financing entities sit
- where the key assets sit
- what the most important structural and credit features are
- any unusual quirks in the structure

2. INCLUDED ENTITIES
Provide a list or table of each included entity, labeled as applicable:
- parent
- holdco
- operating
- financing
- issuer
- co-issuer
- guarantor
- borrower
- asset owner
- regulated
- legacy
- unrestricted
- grouped bucket

3. ENTITY-LEVEL REPORTING AND PUBLIC INFORMATION SOURCES
Provide a table with columns such as:
- Entity
- Role in structure
- Reporting / filing type
- Regulator / source
- Public documents available
- What those documents help confirm
- Underwriting usefulness
- Notes / limitations

4. ORG CHART
Create the organizational structure chart in Excel using **merged, shaded cells only**, closely following the attached JPEG sample layout and color logic.

5. EXCEL FILE
Provide the finished .xlsx workbook containing the cell-based chart on the "Org Chart" sheet and thoughtful commentary on the "Notes" sheet.

6. SUPPORTING CODE
If required by the environment, provide the Python (openpyxl / xlsxwriter) code used to generate the workbook — **cell formatting only, no drawing layer**.

7. ASSUMPTIONS / UNCERTAINTIES
List any ownership relationships, classifications, financial figures, or reporting-status items that are uncertain, estimated, or inferred.

8. SOURCE SUPPORT
For each major entity or relationship, briefly identify the supporting source.

==================================================
IMPORTANT RULES
==================================================
- follow the attached JPEG closely in **layout and color coding**, using cells not shapes
- keep the chart readable on one page
- **never use Excel shapes, connectors, SmartArt, or chart objects for the org chart**
- emphasize credit relevance over legal completeness
- do not dump every subsidiary from Exhibit 21
- distinguish operating entities from financing entities
- make debt issuer / guarantor / borrower chains obvious
- highlight debt location versus EBITDA location
- identify where key assets sit
- identify structural-subordination, trapped-cash, regulatory-separation, and ring-fencing issues where relevant
- identify which entities separately report or file publicly
- use short descriptors inside boxes, not long paragraphs
- use color to signal importance, not decoration
- do not invent unsupported structure or metrics

The final deliverable should look like the attached sample translated into a **cell-formatted** Excel org chart for the target company, while also providing the reporting and filing roadmap needed to deepen the underwriting.`;

function sampleImageUrlsBlockForOrigin(appOrigin: string): string {
  const origin = appOrigin.trim();
  return !origin
    ? ORG_CHART_SAMPLE_IMAGE_PATHS.map(
        (p, i) =>
          `${i + 1}. After you open this app in a browser, use: <your app URL>${p} (or attach from the Org Chart tab thumbnails).`
      ).join("\n")
    : ORG_CHART_SAMPLE_IMAGE_PATHS.map((p, i) => `${i + 1}. ${origin}${p}`).join("\n");
}

/** Apply ticker, company name, and sample-image URL block to an org-chart prompt template. */
export function resolveOrgChartTemplate(
  template: string,
  params: { ticker: string; companyName?: string | null; appOrigin: string }
): string {
  const safeTicker = params.ticker.trim();
  if (!safeTicker) return "";
  const urls = sampleImageUrlsBlockForOrigin(params.appOrigin);
  return fillCompanyPromptTemplate(template, safeTicker, params.companyName).replace(/\[SAMPLE_IMAGE_URLS\]/g, urls);
}

/** Same substitution logic as the Org Chart tab (for bulk “Open in Claude”). */
export function buildOrgChartPrompt(params: { ticker: string; companyName?: string | null; appOrigin: string }): string {
  return resolveOrgChartTemplate(ORG_CHART_PROMPT_TEMPLATE, params);
}
