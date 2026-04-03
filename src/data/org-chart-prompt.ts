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
2. the final organizational chart produced as an EXCEL FILE (.xlsx), with boxes, lines, labels, colors, and text drawn directly in Excel so that it visually resembles the attached JPEG sample as closely as practical

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
- one-page chart
- top-down hierarchy
- ultimate parent at the top
- direct subsidiaries shown beneath their parent
- ownership lines connecting parent and child
- ownership percentages labeled on connector lines, such as "100%"

2. Box style
- default box style: dark / black background with white text
- yellow boxes for especially important financing / issuer / debt entities
- green boxes for especially important operating / cash-generating / core asset-owning / core regulated entities
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
- similar box placement logic
- similar visual density
- similar use of highlighted boxes
- similar spacing and connector placement
- readable in one page
- presentation-ready

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
- draw the chart directly in the worksheet using Excel shapes
- use rectangular boxes for entities
- use straight connectors or elbow connectors between parent and child entities
- label ownership percentages on or near the connector lines
- size and space the boxes so the chart fits cleanly on one sheet
- keep the chart readable at normal zoom
- align the layout to resemble the attached JPEG sample as closely as practical
- make the chart presentation-ready with no manual rearrangement required after creation

Formatting requirements:
- black fill with white font for standard boxes
- yellow fill with black font for key financing / issuer / debt boxes
- green fill with white or black font for core operating / key cash-generating / key asset-owning boxes, whichever is more readable
- consistent font size
- consistent border thickness
- consistent connector style
- no unnecessary decorative elements

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

1. produce Python code using openpyxl, xlsxwriter, or another suitable library to create the Excel workbook and draw the chart as closely as possible

2. where Python Excel libraries cannot fully replicate the connectors or text boxes cleanly, also produce VBA or Office Script code that creates the boxes, connector lines, ownership labels, colors, and layout in Excel

3. include a precise placement map with:
- worksheet name
- box coordinates
- box sizes
- connector start and end points
- label positions
- color assignments
- row / column anchor plan

Do not stop at a written analysis only.
The goal is a reproducible Excel chart.

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
Create the organizational structure chart in Excel, closely following the attached JPEG sample.

5. EXCEL FILE
Provide the finished .xlsx workbook containing the chart.

6. SUPPORTING CODE
If required by the environment, provide the Python / VBA / Office Script used to generate the workbook.

7. ASSUMPTIONS / UNCERTAINTIES
List any ownership relationships, classifications, financial figures, or reporting-status items that are uncertain, estimated, or inferred.

8. SOURCE SUPPORT
For each major entity or relationship, briefly identify the supporting source.

==================================================
IMPORTANT RULES
==================================================
- follow the attached JPEG closely
- keep the chart readable on one page
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

The final deliverable should look like the attached sample translated into Excel for the target company, while also providing the reporting and filing roadmap needed to deepen the underwriting.`;

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
  const displayName = (params.companyName?.trim() || safeTicker) || "";
  const urls = sampleImageUrlsBlockForOrigin(params.appOrigin);
  return template
    .replace(/\[COMPANY NAME\]/g, displayName)
    .replace(/\[TICKER\]/g, safeTicker)
    .replace(/\[SAMPLE_IMAGE_URLS\]/g, urls);
}

/** Same substitution logic as the Org Chart tab (for bulk “Open in Claude”). */
export function buildOrgChartPrompt(params: { ticker: string; companyName?: string | null; appOrigin: string }): string {
  return resolveOrgChartTemplate(ORG_CHART_PROMPT_TEMPLATE, params);
}
