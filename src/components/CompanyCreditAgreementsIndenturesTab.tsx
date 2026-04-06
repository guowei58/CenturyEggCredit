"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Card } from "@/components/ui";
import { fetchSavedTabContent, saveToServer } from "@/lib/saved-data-client";
import { chatGptOpenStatusMessage, openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import {
  CHATGPT_META_GEMINI_LONG_URL_NOTICES,
  OPEN_IN_EXTERNAL_AI_FULL_LINE,
  openGeminiWithClipboard,
} from "@/lib/gemini-open-url";
import { openMetaAiWithClipboard } from "@/lib/meta-ai-open-url";
import { SavedResponseExpandableShell, SAVED_RESPONSE_FS_FILL_CLASS } from "@/components/SavedResponseExpandableShell";
import { SavedRichText } from "@/components/SavedRichText";
import { RichPasteTextarea } from "@/components/RichPasteTextarea";
import { CreditAgreementsFilesBox } from "@/components/CreditAgreementsFilesBox";
import { TabPromptApiButtons } from "@/components/TabPromptApiButtons";
import { PromptTemplateBox } from "@/components/PromptTemplateBox";
import { usePromptTemplateOverride } from "@/lib/prompt-template-overrides";

export const PROMPT_TEMPLATE = `Find all debt-related documents for {{TICKER}} and provide direct clickable links.

You are a forensic credit analyst and debt-document researcher. Your task is to identify, organize, and link to the key debt documents for the company identified by {{TICKER}}.

I want a comprehensive, source-backed document finder for the company’s debt stack. Do not give me a generic debt summary. I want the actual underlying documents, with direct links that I can click into.

==================================================
PRIMARY OBJECTIVE
==================================================
For {{TICKER}}, find and organize as many of the following debt-related documents as possible:

- credit agreements
- term loan agreements
- revolving credit agreements
- ABL agreements
- indentures
- supplemental indentures
- first supplemental indentures
- second / third / later supplemental indentures
- amendments
- amendment no. 1 / 2 / 3 etc.
- joinders
- accession agreements
- guarantee agreements
- guarantor joinders
- collateral agreements
- security agreements
- pledge agreements
- intercreditor agreements
- subordination agreements
- note purchase agreements
- exchange offer documents
- offering memoranda / offering circulars
- registration rights agreements
- debt commitment letters if public
- bridge financing documents if public
- receivables facility documents
- securitization / ABS documents
- warehouse facility documents
- DIP / bankruptcy financing docs if relevant
- amendments and waivers related to debt facilities
- maturity extension agreements
- liability management or exchange transaction documents
- trustee documents if public
- any other material debt instrument documents

The output should help me quickly find the primary legal documents underlying the capital structure.

==================================================
SOURCE PRIORITY
==================================================
Search these sources first and most heavily:

1. SEC filings
   - 10-K
   - 10-Q
   - 8-K
   - 8-K/A
   - S-4
   - S-3
   - S-1
   - 424B prospectuses
   - registration statements
   - exhibit index pages
   - EX-4 indentures
   - EX-10 credit agreements and amendments
   - EX-99 debt transaction summaries where relevant

2. Debt-specific SEC exhibits
   - credit agreements
   - indentures
   - supplemental indentures
   - amendment agreements
   - guarantee / collateral / pledge documents
   - intercreditor agreements
   - joinders

3. Exchange / refinancing / LME documents
   - exchange offer memoranda
   - consent solicitations
   - tender offer docs
   - amend-and-extend docs
   - drop-down / uptier / priming related public docs if any

4. Other public sources if needed
   - investor relations pages
   - trustee or noteholder materials if public
   - bankruptcy dockets if relevant
   - rating agency writeups only to identify document existence, not as the main source
   - press releases announcing debt deals
   - debt trading platforms or public summaries only if they help locate the official document

==================================================
COMPREHENSIVENESS RULE
==================================================
Be comprehensive.

Do not stop after finding one credit agreement and one indenture.

I want the full debt-document package where possible, including:
- original documents
- amended and restated documents
- all important amendments
- supplements
- joinders
- related collateral / guarantee agreements
- intercreditor docs
- exchange / refinancing documents
- post-quarter-end financing updates if public

If a facility has gone through multiple amendments, try to capture the full chain.

If a note indenture has supplements or related exchange documents, include those too.

==================================================
CLICKABLE LINK REQUIREMENT
==================================================
For every document you find, provide:
- document title
- document type
- security / facility it relates to
- filing date
- filing source
- direct clickable link to the document itself if possible
- fallback link to the filing page if the direct exhibit link is unavailable

I want actual links I can click.

If possible, provide both:
1. direct exhibit link
2. parent filing link

==================================================
REQUIRED OUTPUT FORMAT
==================================================
Organize the output exactly as follows:

1. EXECUTIVE SUMMARY
Give a short summary covering:
- how many major debt facilities / securities the company appears to have
- which types of debt documents were found
- whether coverage appears complete or partial
- whether the debt stack looks simple or complex
- any notable issues, such as missing exhibits, nonpublic docs, or messy amendment history

2. DOCUMENT TABLE
Provide a structured table with these columns:

- Security / Facility
- Document Type
- Document Title
- Filing Date
- Filing / Source
- Direct Document Link
- Filing Link
- Notes

Examples of “Security / Facility”:
- Revolving Credit Facility
- Term Loan B
- 6.75% Senior Notes due 2029
- ABL Facility
- Receivables Securitization Facility
- Convertible Notes
- DIP Facility

Examples of “Document Type”:
- Credit Agreement
- Indenture
- Supplemental Indenture
- Amendment
- Joinder
- Guarantee Agreement
- Collateral Agreement
- Intercreditor Agreement
- Exchange Offer Memorandum
- Tender Offer Document
- Security Agreement

3. GROUPED BY DEBT INSTRUMENT
After the full table, regroup the documents by each major debt instrument or facility.

For each major debt bucket, show:
- facility / security name
- primary governing document
- all amendments / supplements
- related guarantee / collateral / intercreditor docs
- direct links

This section should make it easy for me to see the full document chain for a given instrument.

4. IMPORTANT MISSING DOCUMENTS
List anything that appears to exist but was not found publicly, such as:
- missing amendments
- referenced but unavailable schedules
- private offering materials not publicly filed
- missing collateral documents
- trustee docs not publicly posted
- debt docs mentioned in filings but not attached

5. SOURCE NOTES
Briefly explain where the documents were found:
- SEC exhibit search
- specific 8-K
- 10-K exhibit index
- S-4 / exchange filing
- investor relations page
- bankruptcy docket
- other source

==================================================
SEARCH METHOD
==================================================
Use a debt-document hunting approach, not a casual company overview approach.

For {{TICKER}}, do the following:
1. identify the company and latest SEC filer name
2. review the latest 10-K and 10-Q debt footnotes for all debt instruments mentioned
3. review exhibit indexes in 10-K, 10-Q, and especially 8-Ks for agreements and amendments
4. search specifically for:
   - “credit agreement”
   - “indenture”
   - “supplemental indenture”
   - “amendment”
   - “amended and restated”
   - “joinder”
   - “guarantee”
   - “security agreement”
   - “pledge agreement”
   - “intercreditor”
   - “term loan”
   - “revolving credit”
   - “ABL”
   - “note purchase agreement”
   - “exchange offer”
   - “consent solicitation”
   - “tender offer”
   - “receivables facility”
   - “warehouse facility”
   - “securitization”
5. tie each document back to the relevant debt instrument
6. provide direct links to the actual exhibit whenever possible

==================================================
IMPORTANT RULES
==================================================
- always use {{TICKER}} as the target ticker
- provide clickable links
- prioritize original legal documents over summaries
- do not stop at high-level debt footnotes
- include amendments and supplemental documents, not just the original agreement
- group documents by security / facility so the output is actually usable
- distinguish clearly between direct exhibit links and filing-page links
- if a document is referenced but not publicly available, say so clearly
- do not guess when a document cannot be located
- be comprehensive and organized

The final output should feel like a real debt-document index built by a credit analyst for underwriting and document review.`;

export const DOC_REVIEW_PROMPT = `You are a top-tier distressed debt / special situations credit analyst and legal-document reviewer. I am going to paste a credit agreement, indenture, or related debt document. Your job is to extract, organize, and explain everything that matters to a distressed analyst.

Your objectives are:

1. Tell me exactly how the document works economically and legally.
2. Identify all provisions that matter for downside risk, restructuring optionality, collateral leakage, liability management, and recoveries.
3. Explain the covenant package in plain English, but with technical precision.
4. Focus especially on anything that could affect priming risk, lien subordination, structural subordination, restricted payment capacity, debt incurrence capacity, asset transfer flexibility, EBITDA add-backs, and covenant compliance.
5. Do not miss hidden flexibilities, loopholes, or blocker provisions.

Very important instructions:

- Base everything only on the text I paste.
- Do not hallucinate or assume market-standard language if it is not in the document.
- Cite the exact section number, definition name, schedule, exhibit, annex, or page reference for every important point.
- Quote short key snippets only when necessary.
- Separate clearly:
  a) what the document explicitly says,
  b) what it likely means in practice,
  c) what is ambiguous or requires further documents.
- If amendments, supplements, joinders, guarantee agreements, security documents, intercreditor agreements, collateral agency provisions, or exhibits are missing, tell me exactly what is missing and why it matters.
- If the pasted text is incomplete, still do the best possible job and identify the highest-priority gaps.
- Write like a distressed analyst speaking to another distressed analyst: precise, skeptical, commercially focused.

Please produce the output in the exact structure below:

==================================================
1. EXECUTIVE SUMMARY
==================================================

Give me a concise but high-value summary of the document:
- Document type
- Issuer / borrower / parent / guarantor structure
- Secured vs unsecured
- Lien priority
- Key covenant style (maintenance vs incurrence)
- Main protections for creditors
- Main weaknesses / loopholes
- Main distressed takeaways
- Whether this is creditor-friendly, sponsor-friendly, or unusually loose/tight

Then give:
- Top 10 things a distressed analyst should care about most
- Top 5 hidden risks
- Top 5 hidden protections
- Top 5 follow-up documents I should locate next

==================================================
2. CAPITAL STRUCTURE / OBLIGOR MAP
==================================================

Identify and explain:
- Issuer(s)
- Borrower(s)
- Parent entities
- Guarantors
- Non-guarantor subsidiaries
- Restricted subsidiaries
- Unrestricted subsidiaries
- Excluded subsidiaries
- Foreign subsidiaries
- JV / minority-owned subs
- Special-purpose entities
- Any entity designation mechanics

Explain:
- Who actually owes the debt
- Who guarantees it
- Who grants liens
- Which assets sit outside the guarantee / collateral package
- Any structural subordination issues
- Any entities that could trap value away from creditors

Provide a simple text org-chart style summary:
[Parent]
  -> [Borrower / Issuer]
  -> [Guarantors]
  -> [Non-guarantor subs]
  -> [Unrestricted / excluded subs]

Then answer:
- Where is the value likely to sit?
- Which creditors have claim to that value?
- What are the main leakage points?

==================================================
3. SECURITY PACKAGE / COLLATERAL ANALYSIS
==================================================

Analyze the security package in detail:
- What collateral is pledged?
- Which entities pledge collateral?
- What is excluded from collateral?
- Are there material exclusions, thresholds, caps, or after-acquired property limitations?
- Are there limitations on foreign equity pledges?
- Are there control agreement requirements for deposit accounts / securities accounts?
- Is collateral automatically released in certain circumstances?
- What are the release provisions for guarantees and liens?
- Are there asset sale, threshold, or disposal-based release provisions?
- Are there “permitted liens” that can materially dilute collateral?
- Are there carve-outs that make the lien package weaker than it first appears?

Then summarize:
- Practical strength of the collateral package
- Most valuable likely collateral
- Biggest holes in the collateral package
- What additional documents would confirm perfection and priority

==================================================
4. FINANCIAL COVENANTS
==================================================

Identify every financial covenant in the document, including:
- First lien leverage ratio
- Total leverage ratio
- Secured leverage ratio
- Interest coverage ratio
- Fixed charge coverage ratio
- Minimum liquidity
- Net worth tests
- Capex tests
- Maintenance covenants in revolvers or term loans
- Springing covenants
- Testing dates and testing triggers
- Equity cure provisions
- Cash netting rules
- Ratio step-downs or step-ups
- Holiday periods / testing suspensions / acquisition adjustments

For each financial covenant, provide:
- Exact covenant name
- Section reference
- Formula
- Numerator
- Denominator
- Whether net debt or gross debt
- Which debt counts and which does not
- Whether cash is netted and under what limits
- Testing frequency
- Whether tested only when revolver drawn
- Cure rights
- Consequences of breach
- Any unusual drafting or flexibility

Then provide:
- A plain English explanation of how hard or easy the covenant is to comply with
- What management could do to avoid tripping it
- How much EBITDA manipulation or add-back flexibility affects compliance
- What a distressed analyst should watch quarter to quarter

==================================================
5. EBITDA DEFINITION / COVENANT CALCULATION DEEP DIVE
==================================================

This section is extremely important.

Fully analyze the definitions of:
- EBITDA
- Consolidated EBITDA
- Adjusted EBITDA
- Consolidated Net Income
- Fixed Charges
- Consolidated Interest Expense
- Total Debt
- Secured Debt
- First Lien Debt
- Capitalized Lease Obligations
- Consolidated Cash Flow
- Available Amount / Builder Basket, if relevant
- Any defined term that drives covenant capacity

For EBITDA and covenant calculations, do all of the following:

A. Definition walk-through
- Break the EBITDA definition into every component
- Show the starting point
- Show every add-back
- Show every deduction
- Show all pro forma rights
- Show acquisition / disposition adjustments
- Show run-rate synergies
- Show cost savings
- Show restructuring charges
- Show non-recurring / unusual / extraordinary items
- Show stock comp treatment
- Show FX treatment
- Show pension / litigation / casualty / transaction cost treatment
- Show revenue synergies, if allowed
- Show “expected to be realized” language
- Show time periods permitted for realization
- Show caps, limits, and anti-abuse language

B. EBITDA quality assessment
Tell me:
- How aggressive the EBITDA definition is
- Which add-backs are most dangerous
- Which add-backs are uncapped
- Which add-backs are subjective
- Which add-backs are most likely to inflate covenant capacity
- Whether there are “phantom EBITDA” or forward-looking adjustments
- Whether the definition is borrower-friendly, sponsor-friendly, or market-normal

C. Covenant compliance implications
Explain:
- How EBITDA flows into each covenant or basket
- Which ratios are most sensitive to EBITDA inflation
- Which baskets expand as EBITDA grows
- Which definitions create circular capacity
- Whether EBITDA can materially overstate real cash earnings
- Whether synergies / projected savings / pro forma adjustments could create artificial compliance

D. Worked example
If enough information is present, show a sample covenant calculation framework:
- Starting GAAP EBITDA or CNI
- Add-backs
- Deductions
- Pro forma adjustments
- Final covenant EBITDA
- Resulting leverage / coverage ratio

If exact math cannot be done from the pasted text alone, still show the formula architecture and explain where judgment enters.

==================================================
6. NEGATIVE COVENANTS
==================================================

Identify and analyze every negative covenant, including all limitations on:
- Additional debt
- Liens
- Restricted payments
- Dividends
- Investments
- Asset sales
- Affiliate transactions
- Mergers / consolidations
- Fundamental changes
- Sale-leasebacks
- Prepayments of junior debt
- Amendments to junior debt
- Changes in business
- Transactions with unrestricted subs
- Burdensome agreements
- Dividend blockers
- Fiscal year changes
- Accounting changes
- Sanctions / anti-corruption / AML covenants if relevant
- Use of proceeds restrictions if relevant

For each negative covenant:
- Explain the core rule
- Explain every basket, carve-out, exception, and grower feature
- Note whether baskets are free-and-clear, ratio-based, builder-based, reclassification-capable, or RP-capacity based
- Note whether baskets can be re-used
- Note whether there is no-default / event-of-default condition
- Note whether there is a “pro forma compliance” condition
- Note whether there is a test based on first lien leverage, secured leverage, total leverage, FCCR, etc.
- Note whether there are starter baskets, general baskets, ratio debt baskets, local baskets, foreign baskets, non-loan-party baskets, receivables baskets, purchase-money baskets, hedging baskets, intercompany baskets, refinancing baskets, and acquisition baskets

Then give me:
- The most permissive baskets
- The baskets most likely to be used in a liability management exercise
- The baskets most likely to permit leakage away from existing creditors
- Any baskets that look normal individually but become dangerous when combined

==================================================
7. BASKET / CAPACITY SCHEDULE
==================================================

Build a full basket summary table in text form.

For each basket / allowance, list:
- Covenant category
- Basket name / type
- Fixed amount or ratio test
- Grower feature, if any
- Conditions to use
- Whether it is shared or separate capacity
- Whether it can be reclassified
- Whether usage can be reloaded / replenished
- Whether proceeds must be reinvested or prepaid
- Whether there is a no-default condition
- Whether there is a pro forma ratio condition
- Strategic distressed significance

Then after the table, explain:
- Which baskets are most important
- Which are easiest to use
- Which are misleadingly small or large
- Which interact with each other in dangerous ways
- Whether there is meaningful “trap door” capacity
- Whether unrestricted sub designation can unlock additional capacity
- Whether there is hidden portability capacity in acquisition, JV, foreign sub, or non-loan-party baskets

==================================================
8. ASSET SALE / PREPAYMENT / ECF / SWEEP ANALYSIS
==================================================

Explain in detail:
- Asset sale covenant
- What counts as an asset sale
- Permitted asset sales
- Fair market value requirements
- Cash consideration requirements
- Reinvestment rights
- Reinvestment periods
- Mandatory prepayment requirements
- Debt prepayment waterfall
- Excess cash flow sweep
- Step-downs
- Exceptions and carve-outs
- Application of proceeds
- Whether asset sale proceeds can be moved outside the credit group before being trapped
- Whether casualty / condemnation proceeds are covered
- Whether sale proceeds can support junior debt repayment or restricted payments

Then summarize:
- How protected creditors are in a downside scenario
- Whether asset sale proceeds are meaningfully trapped
- Whether there are leakage routes

==================================================
9. EVENTS OF DEFAULT / REMEDIES
==================================================

Identify all Events of Default and analyze:
- Payment default
- Covenant default
- Financial covenant breach
- Cross-default / cross-acceleration
- Bankruptcy / insolvency
- Judgment default
- ERISA
- Change of control
- Invalidity of guarantees / liens
- Security document breach
- Intercreditor breach if applicable
- Material adverse effect if applicable

For each:
- Trigger
- Grace period
- Threshold
- Consequence
- Whether automatic acceleration applies
- Who controls remedies
- Required lender / holder thresholds
- Any standstill or blockage provisions

Then explain:
- Which EODs matter most in practice
- Which are likely early warning signs in distress
- Which are lender-friendly vs borrower-friendly

==================================================
10. AMENDMENT / WAIVER / VOTING THRESHOLDS
==================================================

Analyze:
- Required lenders / majority holders thresholds
- Sacred rights / unanimous or each-affected-lender consent rights
- Incremental / ratio debt / permitted refinancing consent mechanics
- Ability to amend covenants
- Ability to subordinate liens or claims by amendment
- Ability to release all or substantially all collateral / guarantees
- Waterfall amendment thresholds
- Open market purchase provisions
- Dutch auction provisions
- Yank-a-bank provisions
- Defaulting lender provisions if this is a credit agreement

Then tell me:
- What minority lenders can block
- What they cannot block
- Whether majority lenders could facilitate a coercive transaction
- Whether sacred rights are robust or weak

==================================================
11. LIABILITY MANAGEMENT / LME ANALYSIS
==================================================

This section is critical.

Analyze whether the document facilitates or blocks:
- Dropdown transactions
- Uptier exchanges
- Double-dip structures
- Non-pro-rata exchanges
- Priming debt
- Superpriority debt
- Incremental debt
- Ratio debt
- Refinancing debt
- Receivables financing
- Factoring / securitization
- FILO / delayed draw / sidecar debt
- Debt at non-loan-party / non-guarantor subsidiaries
- Debt at unrestricted subsidiaries
- Structurally senior debt
- Liens on previously unencumbered assets
- Inside maturity walls
- Debt incurred under “Credit Agreement Refinancing Indebtedness,” “Permitted Refinancing,” “Incremental Equivalent Debt,” “Ratio Debt,” or similar concepts
- Intercompany debt that can migrate value
- Transfer of IP, equity interests, foreign assets, real estate, JV interests, receivables, or other crown-jewel assets outside the credit group

Specifically identify:
- Potential LME blockers
- Potential LME loopholes
- Whether pro rata sharing provisions are strong or weak
- Whether open market purchase language can be abused
- Whether “sacred rights” would stop a priming or uptier
- Whether non-consenting lenders could be subordinated, primed, or left behind
- Whether unrestricted sub designation is a trap door
- Whether investment and RP baskets can be combined to move value
- Whether lien covenants and debt covenants interact to allow priming
- Whether value can be transferred through permitted investments, asset sales, affiliate transactions, intercompany transfers, or release provisions

Then provide:
- A realistic LME playbook available to the company / sponsor based on this document
- A realistic defense playbook available to minority creditors
- Your bottom-line view on priming risk: low / medium / high
- Your bottom-line view on leakage risk: low / medium / high

==================================================
12. CHANGE OF CONTROL / PORTABILITY / ACQUISITION FLEXIBILITY
==================================================

Explain:
- Change of control definition
- Put rights / acceleration rights
- Portability features
- Acquisition and merger flexibility
- Whether debt can travel with acquired entities
- Whether acquired debt can remain outstanding
- Whether acquired liens can remain outstanding
- Whether there are “acquired company” baskets that materially expand capacity

Then summarize:
- How much flexibility management has to reshape the group
- Whether the covenant package can loosen after acquisitions

==================================================
13. RESTRICTED VS UNRESTRICTED SUBSIDIARY MECHANICS
==================================================

Explain:
- How subs can be designated unrestricted
- Conditions to designation
- Default conditions
- Investment usage required
- Debt and lien treatment post-designation
- Ability to re-designate back into the restricted group
- Whether there are automatic designation features
- Whether there are excluded assets or entities that already sit outside the package

Then explain the distressed significance:
- Can crown jewels be moved out?
- Can debt be raised outside the restricted group?
- Can value be trapped away from creditors?
- Is there a known trap door here?

==================================================
14. RECOVERY / ENFORCEMENT / DISTRESSED TAKEAWAYS
==================================================

Give me a distressed analyst’s synthesis of:
- Who has first claim on value
- Where recoveries could leak
- What assets appear insulated from creditors
- What claims look structurally subordinated
- Which legal entities matter most
- Whether collateral and guarantees are likely materially better or worse than headline marketing suggests
- Whether covenant capacity meaningfully weakens expected recoveries

Then provide:
- Top recovery risks
- Top enforcement risks
- Top documentation strengths
- Top documentation weaknesses

==================================================
15. RED FLAGS, AMBIGUITIES, AND MISSING ITEMS
==================================================

List every important ambiguity, drafting oddity, or missing piece, including:
- Definitions that are circular or unclear
- Basket interactions that are hard to measure without schedules
- Missing exhibits, security documents, joinders, guarantees, amendments, or intercreditor agreements
- Any provision that needs cap table / debt schedule / subsidiary list / compliance certificate support
- Any point where the answer depends on amounts not in the text

For each one, explain:
- Why it matters
- What document or information I need next

==================================================
16. FINAL DISTRESSED SCORECARD
==================================================

Score each from 1 to 5, where:
1 = very creditor-friendly / tight / protective
5 = very borrower-friendly / loose / risky for existing creditors

Score:
- EBITDA aggressiveness
- Debt incurrence flexibility
- Lien flexibility
- RP / leakage flexibility
- Investment flexibility
- Asset transfer risk
- Priming risk
- Guarantee strength
- Collateral strength
- Amendment vulnerability
- LME vulnerability
- Overall documentation looseness

Then give:
- Overall score
- 1 paragraph on why
- 1 paragraph on what matters most for valuation / recovery / trading

==================================================
17. APPENDIX: SECTION-BY-SECTION REFERENCE LIST
==================================================

Create a reference list of the most important sections and definitions, with:
- Section / definition name
- Why it matters
- One-sentence takeaway

Final style rules:
- Be comprehensive, not brief.
- Use plain English first, then technical detail.
- Highlight anything non-obvious.
- When in doubt, be skeptical.
- Prioritize what matters in distress, restructuring, and downside protection.
- Always tie conclusions back to the actual text.

I will now paste the document below:

[PASTE CREDIT AGREEMENT / INDENTURE / AMENDMENTS / NOTES HERE]`;

const CLAUDE_NEW_CHAT_BASE = "https://claude.ai/new";
const SAVED_PREFIX = "century-egg-credit-agreements-indentures-";

type SavedBoxKey =
  | "credit-agreements-indentures-credit-agreement"
  | "credit-agreements-indentures-first-lien-indenture"
  | "credit-agreements-indentures-second-lien-indenture"
  | "credit-agreements-indentures-unsecured"
  | "credit-agreements-indentures-convertible"
  | "credit-agreements-indentures-preferred"
  | "credit-agreements-indentures-other";

const BOXES: Array<{ title: string; key: SavedBoxKey; storagePrefix: string; fallback?: { key: "credit-agreements-indentures"; storagePrefix: string } }> = [
  {
    title: "Document list",
    key: "credit-agreements-indentures-other",
    storagePrefix: "century-egg-credit-agreements-indentures-other-",
    fallback: { key: "credit-agreements-indentures", storagePrefix: SAVED_PREFIX },
  },
  {
    title: "Credit agreement",
    key: "credit-agreements-indentures-credit-agreement",
    storagePrefix: "century-egg-credit-agreements-indentures-credit-agreement-",
  },
  {
    title: "1st lien indenture",
    key: "credit-agreements-indentures-first-lien-indenture",
    storagePrefix: "century-egg-credit-agreements-indentures-first-lien-indenture-",
  },
  {
    title: "2nd lien indenture",
    key: "credit-agreements-indentures-second-lien-indenture",
    storagePrefix: "century-egg-credit-agreements-indentures-second-lien-indenture-",
  },
  {
    title: "Unsecured",
    key: "credit-agreements-indentures-unsecured",
    storagePrefix: "century-egg-credit-agreements-indentures-unsecured-",
  },
  {
    title: "Convertible",
    key: "credit-agreements-indentures-convertible",
    storagePrefix: "century-egg-credit-agreements-indentures-convertible-",
  },
  {
    title: "Preferred",
    key: "credit-agreements-indentures-preferred",
    storagePrefix: "century-egg-credit-agreements-indentures-preferred-",
  },
];

function SavedResponseBox({
  ticker,
  title,
  saveKey,
  storagePrefix,
  fallback,
  refreshKey = 0,
}: {
  ticker: string;
  title: string;
  saveKey: SavedBoxKey;
  storagePrefix: string;
  fallback?: { key: "credit-agreements-indentures"; storagePrefix: string };
  /** Increment when another control (e.g. API) writes this key so we reload from server. */
  refreshKey?: number;
}) {
  const safeTicker = ticker?.trim() ?? "";
  const [savedContent, setSavedContent] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const [isEditing, setIsEditing] = useState(true);

  useEffect(() => {
    if (!safeTicker) return;
    let cancelled = false;
    (async () => {
      let loaded = await fetchSavedTabContent(safeTicker, saveKey);
      if (!loaded.trim() && fallback) {
        loaded = await fetchSavedTabContent(safeTicker, fallback.key);
      }

      if (!cancelled) {
        setSavedContent(loaded);
        setIsEditing(loaded.length === 0);
        setEditDraft("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [safeTicker, saveKey, storagePrefix, fallback, refreshKey]);

  async function handleSaveResponse() {
    const trimmed = editDraft.trim();
    if (!safeTicker) return;
    await saveToServer(safeTicker, saveKey, trimmed);
    setSavedContent(trimmed);
    setIsEditing(false);
    setEditDraft("");
  }

  function handleReplace() {
    setEditDraft(savedContent);
    setIsEditing(true);
  }

  return (
    <SavedResponseExpandableShell title={title} className="rounded-lg" fillViewportMinHeight={false}>
      {isEditing ? (
        <>
          <RichPasteTextarea
            value={editDraft}
            onChange={setEditDraft}
            placeholder="Paste your notes / extraction / AI output here, then click Save."
            className={`min-h-[220px] w-full resize-y rounded border bg-[var(--card2)] px-3 py-3 text-sm leading-relaxed placeholder:font-sans focus:border-[var(--accent)] focus:outline-none ${SAVED_RESPONSE_FS_FILL_CLASS}`}
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={handleSaveResponse}
            className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
          >
            Save
          </button>
        </>
      ) : (
        <>
          <div
            className={`min-h-[220px] overflow-y-auto rounded border border-transparent px-0 py-2 text-sm leading-relaxed ${SAVED_RESPONSE_FS_FILL_CLASS}`}
            style={{ color: "var(--text)" }}
          >
            {savedContent ? <SavedRichText content={savedContent} ticker={safeTicker} /> : <span style={{ color: "var(--muted)" }}>No saved response yet.</span>}
          </div>
          <button
            type="button"
            onClick={handleReplace}
            className="mt-3 shrink-0 rounded border px-4 py-2 text-sm font-medium"
            style={{ borderColor: "var(--border2)", color: "var(--text)" }}
          >
            Replace / Edit
          </button>
        </>
      )}
    </SavedResponseExpandableShell>
  );
}

export function buildCreditAgreementsFindDocsAiPrompt(ticker: string, template: string = PROMPT_TEMPLATE): string {
  const t = ticker.trim();
  return t ? template.replace(/\{\{TICKER\}\}/g, t) : "";
}

export function getCreditAgreementsDocReviewAiPrompt(template: string = DOC_REVIEW_PROMPT): string {
  return template;
}

function linkify(text: string): ReactNode[] {
  const urlRegex = /(https?:\/\/[^\s<>"')\]\}]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noopener noreferrer"
        className="underline break-all"
        style={{ color: "var(--accent)" }}
      >
        {part}
      </a>
    ) : (
      part
    )
  );
}

export function CompanyCreditAgreementsIndenturesTab({ ticker }: { ticker: string }) {
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [clipboardFailed, setClipboardFailed] = useState(false);
  const [savedRefreshKey, setSavedRefreshKey] = useState(0);

  const safeTicker = ticker?.trim() ?? "";
  const { template: findDocsTemplate } = usePromptTemplateOverride(
    "credit-agreements-find-docs",
    PROMPT_TEMPLATE
  );
  const prompt = useMemo(
    () => (safeTicker ? findDocsTemplate.replace(/\{\{TICKER\}\}/g, safeTicker) : ""),
    [safeTicker, findDocsTemplate]
  );
  const { template: docReviewTemplate } = usePromptTemplateOverride(
    "credit-agreements-doc-review",
    DOC_REVIEW_PROMPT
  );
  const docReviewPrompt = docReviewTemplate;

  useEffect(() => {
    setStatusMessage(null);
    setClipboardFailed(false);
  }, [safeTicker]);

  async function copyToClipboard() {
    if (!prompt) return;
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(prompt);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Use the prompt below and copy manually.");
    }
  }

  async function copyText(text: string) {
    setClipboardFailed(false);
    setStatusMessage(null);
    try {
      await navigator.clipboard.writeText(text);
      setStatusMessage("Copied to clipboard.");
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Could not copy. Copy manually from the prompt window.");
    }
  }

  function openInClaude(text: string) {
    if (!text) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const prefillUrl = `${CLAUDE_NEW_CHAT_BASE}?q=${encodeURIComponent(text)}`;
    window.open(prefillUrl, "_blank", "noopener,noreferrer");
    try {
      navigator.clipboard.writeText(text).then(
        () => setStatusMessage("Claude opened in a new tab. Prompt copied to clipboard — paste if needed."),
        () => {
          setClipboardFailed(true);
          setStatusMessage("Claude opened in a new tab. Prompt could not be copied — use prompt below.");
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage("Claude opened in a new tab. Prompt could not be copied — use prompt below.");
    }
  }

  function openInChatGPT(text: string) {
    if (!text) return;
    setStatusMessage(null);
    setClipboardFailed(false);
    const { wasShortened } = openChatGptNewChatWindow(text);
    try {
      navigator.clipboard.writeText(text).then(
        () => {
          setClipboardFailed(false);
          setStatusMessage(chatGptOpenStatusMessage(wasShortened, false));
        },
        () => {
          setClipboardFailed(true);
          setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
        }
      );
    } catch {
      setClipboardFailed(true);
      setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
    }
  }

  function openInMetaAI(text: string) {
    if (!text) return;
    openMetaAiWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  function openInGemini(text: string) {
    if (!text) return;
    openGeminiWithClipboard(text, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {
    return (
      <Card title="Credit Agreements & Indentures">
        <p className="text-sm py-4" style={{ color: "var(--muted2)" }}>
          Select a company to open this prompt in Claude, ChatGPT, or Meta AI.
        </p>
      </Card>
    );
  }

  return (
    <Card title={`Credit Agreements & Indentures — ${safeTicker}`}>
      <div className="flex flex-col gap-6 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-4 lg:min-h-[70vh]">
          {BOXES.map((b) => (
            <SavedResponseBox
              key={b.key}
              ticker={safeTicker}
              title={b.title}
              saveKey={b.key}
              storagePrefix={b.storagePrefix}
              fallback={b.fallback}
              refreshKey={savedRefreshKey}
            />
          ))}
        </div>

        <div className="flex w-full flex-col lg:w-[420px] flex-shrink-0 gap-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
              Prompt 1 — find documents
            </div>
            <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
              {OPEN_IN_EXTERNAL_AI_FULL_LINE}
            </p>
            <PromptTemplateBox
              tabId="credit-agreements-find-docs"
              defaultTemplate={PROMPT_TEMPLATE}
              resolve={(tpl) => (safeTicker ? tpl.replace(/\{\{TICKER\}\}/g, safeTicker) : "")}
              className="mb-3"
            />
            <div className="tab-prompt-ai-actions-grid mb-2">
              <button
                type="button"
                onClick={() => openInClaude(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              >
                Open in Claude
              </button>
              <button
                type="button"
                onClick={() => openInChatGPT(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
              >
                Open in ChatGPT
              </button>
              <button
                type="button"
                onClick={() => openInGemini(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
              >
                Open in Gemini
              </button>
              <button
                type="button"
                onClick={() => openInMetaAI(prompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#0866FF", color: "#0866FF", background: "transparent" }}
              >
                Open in Meta AI
              </button>
              <button
                type="button"
                onClick={() => void copyText(prompt)}
                className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Copy prompt
              </button>
            </div>
            <TabPromptApiButtons
              userPrompt={prompt}
              onResult={async (text) => {
                const t = text.trim();
                if (!safeTicker || !t) return;
                await saveToServer(safeTicker, "credit-agreements-indentures-other", t);
                setSavedRefreshKey((k) => k + 1);
                setStatusMessage("API response saved to the Document list box above.");
                setClipboardFailed(false);
              }}
              className="mt-2 border-t border-[var(--border2)] pt-2"
            />
          </div>

          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: "var(--muted)" }}>
              Prompt 2 — distressed doc review
            </div>
            <p className="text-xs mb-2" style={{ color: "var(--muted2)" }}>
              Paste the actual credit agreement / indenture text into the chat after opening. {CHATGPT_META_GEMINI_LONG_URL_NOTICES}
            </p>
            <PromptTemplateBox
              tabId="credit-agreements-doc-review"
              defaultTemplate={DOC_REVIEW_PROMPT}
              resolve={(tpl) => tpl}
              className="mb-3"
            />
            <div className="tab-prompt-ai-actions-grid mb-2">
              <button
                type="button"
                onClick={() => openInClaude(docReviewPrompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--accent)", color: "var(--accent)", background: "transparent" }}
              >
                Open in Claude
              </button>
              <button
                type="button"
                onClick={() => openInChatGPT(docReviewPrompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
              >
                Open in ChatGPT
              </button>
              <button
                type="button"
                onClick={() => openInGemini(docReviewPrompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#EAB308", color: "#EAB308", background: "transparent" }}
              >
                Open in Gemini
              </button>
              <button
                type="button"
                onClick={() => openInMetaAI(docReviewPrompt)}
                className="tab-prompt-ai-action-btn"
                style={{ borderColor: "#0866FF", color: "#0866FF", background: "transparent" }}
              >
                Open in Meta AI
              </button>
              <button
                type="button"
                onClick={() => void copyText(docReviewPrompt)}
                className="tab-prompt-ai-action-btn tab-prompt-ai-action-btn--grid-singleton"
                style={{ borderColor: "var(--border2)", color: "var(--text)" }}
              >
                Copy prompt
              </button>
            </div>
            <TabPromptApiButtons
              userPrompt={docReviewPrompt}
              onResult={async (text) => {
                const t = text.trim();
                if (!safeTicker || !t) return;
                await saveToServer(safeTicker, "credit-agreements-indentures-credit-agreement", t);
                setSavedRefreshKey((k) => k + 1);
                setStatusMessage("API response saved to the Credit agreement box above.");
                setClipboardFailed(false);
              }}
              className="mt-2 border-t border-[var(--border2)] pt-2"
            />
          </div>
          {statusMessage && (
            <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
              {statusMessage}
            </p>
          )}
          {clipboardFailed && (
            <p className="text-[10px] mt-1" style={{ color: "var(--muted2)" }}>
              Select the prompt above and copy manually (Ctrl+C / Cmd+C).
            </p>
          )}

          <CreditAgreementsFilesBox ticker={safeTicker} />
        </div>
      </div>
    </Card>
  );
}

