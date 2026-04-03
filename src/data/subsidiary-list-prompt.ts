/**
 * Subsidiary List tab prompt. The UI replaces {{TICKER}} at runtime.
 */

export const SUBSIDIARY_LIST_PROMPT_TEMPLATE = `Pull the complete subsidiary list for {{TICKER}}.

You are a forensic corporate-structure and credit analyst. Your task is to build the most comprehensive subsidiary list possible for the company identified by {{TICKER}}.

I do NOT want a casual summary. I want a structured, source-backed subsidiary list that starts with the company’s official subsidiary disclosures and then expands using other public sources where needed.

==================================================
PRIMARY OBJECTIVE
==================================================
For {{TICKER}}, identify and compile the most complete subsidiary list possible, and clearly denote which subsidiaries are most important.

Your job is to:
1. pull the official subsidiary list from the latest available 10-K Exhibit 21 if available
2. supplement it with other public sources if the 10-K list appears incomplete, outdated, abbreviated, or not sufficiently informative
3. normalize entity names where needed
4. identify the most important subsidiaries from an operating, financing, regulatory, legal, and credit perspective
5. organize the list in a way that is useful for underwriting and structure mapping

==================================================
SOURCE PRIORITY
==================================================
Use sources in this priority order:

1. latest 10-K Exhibit 21 subsidiary list
2. latest 10-Q, if it updates legal structure or reporting entities
3. 8-Ks and transaction exhibits
4. credit agreements, bond indentures, guarantee schedules, and other debt documents
5. SEC registration statements, exchange offers, offering memoranda, and merger documents
6. company investor presentations if they identify key operating or reporting entities
7. FCC filings, FCC licenses, FCC ownership reports, or other sector-specific regulatory sources if relevant
8. state regulatory filings, insurance filings, utility filings, foreign registries, or other regulator sources if relevant
9. rating agency reports or public court / bankruptcy filings if they identify material subsidiaries
10. other public sources only if needed to fill gaps

Start with Exhibit 21, but do not stop there if it is clearly incomplete or too high level.

==================================================
COMPREHENSIVENESS RULE
==================================================
Be comprehensive.

That means:
- include all subsidiaries listed in Exhibit 21 or equivalent official filings
- include notable omitted entities that appear in debt documents, guarantor schedules, regulatory filings, or transaction materials
- include important finance subsidiaries, issuers, co-issuers, guarantors, SPVs, ABS vehicles, unrestricted subsidiaries, regulated subsidiaries, and foreign operating entities where publicly identifiable
- include legacy, runoff, non-core, or partially owned entities if they matter to the structure
- include DBA / alternate names only if they materially help identify the entity

Do not silently exclude entities because they seem minor.
If there are hundreds of immaterial entities, you may group the smallest ones only after first listing all material and specifically named entities.

==================================================
WHAT COUNTS AS “IMPORTANT”
==================================================
Clearly denote the most important subsidiaries.

A subsidiary should be flagged as “important” if it appears to be relevant to one or more of the following:
- major operating business
- key asset owner
- debt issuer
- borrower
- guarantor
- regulated entity
- holder of licenses / spectrum / franchises / permits
- significant foreign operating entity
- unrestricted subsidiary
- ABS / securitization / receivables SPV
- holding company in the ownership chain
- entity separately reporting to regulators
- entity frequently referenced in debt docs or legal filings
- entity that appears to hold meaningful assets, EBITDA, or liabilities
- entity important for structural subordination, trapped cash, or ring-fencing analysis

==================================================
REQUIRED OUTPUT
==================================================
Produce the output in the following structure:

1. EXECUTIVE SUMMARY
Write a short summary covering:
- whether {{TICKER}} has a simple or complex subsidiary structure
- how many subsidiaries were identified
- what the main buckets are
- which entities appear most important
- whether the 10-K list seems complete or whether supplemental sources were needed

2. COMPLETE SUBSIDIARY LIST
Provide a comprehensive table with as many subsidiaries as possible.

Use these columns:
- Subsidiary Name
- Parent / Immediate Owner if known
- Ownership % if known
- Jurisdiction / State / Country if known
- Source
- Source Date
- Importance Flag (Important / Secondary / Minor / Unclear)
- Likely Role
- Notes

For “Likely Role,” use labels such as:
- operating subsidiary
- holding company
- financing subsidiary
- issuer
- borrower
- guarantor
- regulated entity
- asset owner
- foreign subsidiary
- unrestricted subsidiary
- ABS / SPV
- legacy / runoff
- shared services
- unclear

3. IMPORTANT SUBSIDIARIES ONLY
Provide a second table showing only the most important subsidiaries.

Use these columns:
- Subsidiary Name
- Why It Matters
- Likely Role
- Key Source Support
- Confidence Level

4. ENTITY BUCKETS / ORGANIZATION
Group subsidiaries into useful buckets if possible, such as:
- major operating subsidiaries
- financing / issuer entities
- guarantor entities
- regulated subsidiaries
- foreign subsidiaries
- unrestricted subsidiaries
- legacy / runoff entities
- SPVs / ABS vehicles
- other named subsidiaries

5. GAPS / LIMITATIONS
List:
- where the 10-K list may be incomplete
- where ownership is unclear
- where an entity is mentioned elsewhere but not in Exhibit 21
- where multiple entities may refer to the same business under different names
- where further manual verification may be needed

==================================================
NORMALIZATION RULES
==================================================
When pulling names:
- preserve the legal entity name as disclosed
- normalize obvious formatting inconsistencies only if needed for readability
- do not merge different entities unless the evidence clearly shows they are the same
- if the same entity appears under slightly different names, note the variation
- if ownership % is not disclosed, mark as “not disclosed”
- if the immediate parent is not disclosed, mark as “unknown”

==================================================
IMPORTANT ANALYTICAL RULES
==================================================
- Start with the latest 10-K Exhibit 21, but do not rely on it blindly
- Be comprehensive and structured
- Denote the most important subsidiaries clearly
- Distinguish official disclosure from inference
- Do not guess when information is not available
- If you infer an entity’s likely role, label it clearly as inferred
- Preserve source traceability for every entity
- If the company has multiple reporting entities or a messy legal structure, reflect that complexity rather than simplifying it away

==================================================
SPECIAL HANDLING FOR COMPLEX STRUCTURES
==================================================
If {{TICKER}} appears to have:
- multiple SEC filers
- holdco / opco separation
- restricted vs unrestricted groups
- foreign operating silos
- securitization entities
- finance company subsidiaries
- regulated subsidiaries
- ring-fenced entities
- bankruptcy-remote vehicles
- JV or partially owned subsidiaries

then call those out explicitly and elevate those entities in the “Important Subsidiaries” table.

==================================================
SOURCE-CITATION REQUIREMENT
==================================================
For each listed subsidiary, show the specific source used where possible, such as:
- 2025 10-K Exhibit 21
- 2026 10-Q
- Credit Agreement dated [date]
- Indenture dated [date]
- FCC license filing
- State insurance filing
- Offering memorandum
- Investor presentation
- Other public filing

Do not provide an uncited list.

==================================================
OUTPUT QUALITY BAR
==================================================
I want the result to feel like a real analyst’s working subsidiary map input:
- comprehensive
- source-backed
- easy to scan
- clear on what is important
- useful for org-chart building, guarantor analysis, and credit work

The final result should help me answer:
1. what are all the named subsidiaries?
2. which ones matter most?
3. what roles do they likely play?
4. what sources support their existence?
5. where is the disclosure incomplete or ambiguous?`;
