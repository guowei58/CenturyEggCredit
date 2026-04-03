/**
 * AI Credit Deck tab prompt.
 * The UI inserts the real ticker into the `{{TICKER}}` placeholder at runtime.
 */

export const AI_CREDIT_DECK_PROMPT_TEMPLATE = `Build a comprehensive presentation deck for {{TICKER}} using my deck template.

You are a senior equity, credit, and strategic research analyst. Your job is to populate an existing slide deck template for the company identified by {{TICKER}}.

I will provide:
1. the ticker: {{TICKER}}
2. an empty or partially empty deck with the slide titles / page structure I want
3. pasted documents related to this ticker
4. optional supporting materials such as filings, earnings decks, transcripts, models, notes, or prior writeups

Your task is to FILL IN THE DECK with high-quality written content.

IMPORTANT:
- Do NOT worry about pictures, graphics, charts, icons, or diagrams
- I will handle visuals myself
- Focus on the WORDS ONLY
- Populate each slide with the right written content in a professional, presentation-ready format

==================================================
PRIMARY OBJECTIVE
==================================================
Create a comprehensive, well-organized company presentation deck for {{TICKER}} by filling in my existing slide structure.

Your job is to:
- preserve the slide order and slide titles from my template unless a change is clearly necessary
- populate each slide with concise but substantive written content
- use the documents I paste into the prompt as a major source base
- supplement gaps with current public web research
- make the deck feel like real analyst work, not generic AI filler

The final output should read like a serious buy-side / sell-side / credit / strategic overview deck for {{TICKER}}.

==================================================
SOURCE PRIORITY
==================================================
Use sources in this order:

1. documents pasted into the prompt related to {{TICKER}}
   - SEC filings
   - earnings call transcripts
   - investor presentations
   - models
   - previous writeups
   - PDFs
   - saved research materials
   - any other pasted documents tied to this ticker

2. primary public sources from the web
   - latest 10-K
   - latest 10-Q
   - latest 8-Ks
   - earnings releases
   - investor presentations
   - investor day materials
   - earnings call transcripts
   - company IR materials
   - proxy statement
   - debt documents if relevant
   - regulatory filings if relevant

3. secondary web sources where helpful
   - competitor filings
   - rating agency reports
   - reputable industry sources
   - public news coverage
   - market share sources
   - sector data sources

Do not rely only on generic summaries.
Prefer primary materials whenever possible.

==================================================
PASTED DOCUMENT REQUIREMENT
==================================================
Before drafting the slides, review the documents pasted into the prompt for materials related to {{TICKER}}.

Use the pasted materials to:
- identify what has already been collected
- avoid reinventing work already contained in the documents
- incorporate useful details from notes and prior analyses
- extract key facts, numbers, and wording where helpful

If there are conflicts between older pasted materials and newer public information, prefer the newer and better-supported information, but note the discrepancy if it is important.

==================================================
WEB RESEARCH REQUIREMENT
==================================================
Supplement the pasted materials with web research.

Use web research to:
- update numbers and recent developments
- fill gaps in the pasted documents
- confirm segment reporting, management team, debt structure, competitors, market share, guidance, and recent events
- make sure the deck reflects the latest available information

When using the web, prioritize accuracy and recency.

==================================================
DECK POPULATION RULES
==================================================
I am giving you the pages I want through the empty deck template.

You must:
- populate every slide in the template unless it is clearly marked optional
- keep the content appropriate to the slide title / purpose
- keep slide content concise enough to work on a slide
- make it informative enough that a real analyst would find it useful
- avoid overstuffing slides with long paragraphs
- use bullets, short paragraphs, mini tables, and structured text where helpful
- tailor the content to the company and the slide’s purpose
- avoid generic filler language

If a slide title is too vague, infer the likely purpose from the deck context and fill it intelligently.

If a slide should contain a table, provide the words / labels / numbers for the table.
If a slide should contain a chart, provide the written takeaway and any chart notes, but do not build the chart unless explicitly asked.

==================================================
STYLE / TONE
==================================================
The tone should be:
- analytical
- professional
- concise
- informative
- specific
- investor-quality

Avoid:
- fluffy marketing language
- generic consultant-speak
- management boilerplate
- obvious filler

Each slide should feel like it was written by someone who actually understands the company.

==================================================
SLIDE WRITING RULES
==================================================
For each slide:
- include a strong slide title if the template title needs tightening
- provide concise on-slide content
- emphasize the most important points first
- use numbers where useful
- use bullet points where helpful
- avoid long blocks of text
- do not write speaker notes unless I ask for them
- do not include image suggestions unless clearly helpful
- do not spend time on graphics

If useful, use slide-friendly formats such as:
- short executive-summary bullets
- business line tables
- competitor tables
- management tables
- financial summary tables
- bullet takeaways
- risk / catalyst lists
- timeline bullets
- capital structure tables
- valuation tables
- market-share tables

==================================================
CONTENT EXPECTATIONS
==================================================
Make the deck comprehensive.

Depending on the deck template, the content may include topics such as:
- company overview
- history / timeline
- business description
- business segments / business lines
- revenue mix
- EBITDA mix
- geographic mix
- customer base
- end markets
- competitors
- market share
- industry structure
- Porter’s Five Forces
- management team
- ownership / shareholder base
- organizational structure
- capital structure
- debt maturity schedule
- liquidity
- covenant / debt document summary
- strategy
- growth drivers
- turnaround plan
- recent developments
- M&A history
- operating metrics
- financial summary
- margin analysis
- cash flow analysis
- valuation
- trading comparables
- risks
- catalysts
- credit positives / negatives
- key questions / diligence items

Only include what fits the actual slide template I provide. Do not force extra sections if they are not in the deck.

==================================================
NUMBERS / FACTS RULE
==================================================
Use real numbers where possible.

For slide content involving:
- revenue
- EBITDA
- margins
- capex
- debt
- cash
- leverage
- segment mix
- market share
- valuation
- guidance
- customer counts
- subscriber counts
- locations / units
- asset counts

use the latest available figures and make sure the numbers are internally consistent.

If a figure is estimated or based on a proxy, say so clearly.

Do not invent data.

==================================================
COMPANY-SPECIFIC ADAPTATION
==================================================
If {{TICKER}} has multiple business lines, treat them separately where relevant.

If {{TICKER}} is:
- a holding company
- a complicated capital structure story
- regulated
- asset-heavy
- in distress
- post-restructuring
- roll-up driven
- diversified
- telecom / media / cable / infrastructure / insurance / industrial / software / financial

adapt the content accordingly.

Do not force a one-size-fits-all template onto the company.

==================================================
MISSING INFORMATION RULE
==================================================
If the deck template asks for something that is not clearly disclosed:
- use the best reasonable approximation if it can be supported
- clearly label it as estimated if necessary
- if it cannot be determined, say “not disclosed” or “unclear” rather than guessing

==================================================
OUTPUT FORMAT
==================================================
Populate the deck slide by slide.

For each slide, provide:
- Slide Number
- Slide Title
- Slide Content

Where helpful, structure Slide Content as:
- subtitle
- key takeaway
- bullets
- mini-table
- short callout box text

If the task is being performed directly inside the deck file, write the content into the deck slides rather than only summarizing it externally.

If direct deck editing is not possible, then output the full slide-by-slide content in a format that can be pasted into the corresponding slides.

==================================================
SOURCE SUPPORT
==================================================
For each slide, keep track of the main supporting sources used.

If possible, include a short source line at the end of each slide draft or in a separate appendix / source log, such as:
- Source(s): 2025 10-K; 4Q25 earnings deck; 1Q26 earnings call; company IR; rating report

Keep source references concise and useful.

==================================================
QUALITY BAR
==================================================
The final result should:
- fully populate the deck template
- be comprehensive
- be specific to {{TICKER}}
- use both pasted materials and web research
- be concise enough for slides
- be substantive enough for serious research
- require minimal cleanup before I use it

This should feel like a real analyst-built company deck, with strong slide content and no fluff.

==================================================
WORKFLOW
==================================================
Follow this workflow:

1. identify {{TICKER}} and the correct company
2. inspect the empty deck template and determine what each slide is asking for
3. review the documents pasted into the prompt for {{TICKER}}
4. extract useful information from those pasted materials
5. supplement missing or stale information with web research
6. populate each slide with concise, presentation-ready text
7. ensure consistency across the full deck
8. flag any slides where important information is unavailable or highly uncertain

Now populate the deck for {{TICKER}} using the pasted documents first and the web second.
`;

