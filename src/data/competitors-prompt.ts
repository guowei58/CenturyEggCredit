/**
 * Competitors tab AI prompt (deep business profiles + SWOT for top competitors).
 * Replace [INSERT TICKER] in the tab UI (e.g. "Acme Corp (ACME)" or "ACME").
 */

export const COMPETITORS_PROMPT_TEMPLATE = `You are a top-tier equity / credit research analyst and competitive intelligence analyst.

I will provide you with a public company ticker. Your job is to identify the **most important competitors** of that company and produce a **deep business profile** for each of the top few competitors.

## Primary goal

Help me understand:

* who the company's most important competitors really are
* which competitors matter most economically and strategically
* what each major competitor actually does
* how each competitor makes money
* how each competitor is positioned versus the target company
* where each competitor is strong, weak, vulnerable, or improving
* what competitive threats or share-shift risks matter most over the next 3–5 years

Ticker: [INSERT TICKER]

---

## Core instructions

* Base the analysis on the company's **actual business mix**, not just broad industry labels.
* Start from the target company's reported segments, but do not stop there.
* Break the company into its real business lines, products, services, and end markets.
* Identify the **top few competitors that matter most**, not a long undifferentiated list.
* Prioritize competitors based on:

  * degree of overlap with the target company
  * revenue / market share relevance
  * strategic threat level
  * pricing pressure
  * risk of disruption or share shift
* Include both **public and private competitors** where relevant.
* Separate:

  * direct competitors
  * adjacent competitors
  * substitute competitors
  * emerging / disruptive competitors
* Be specific and analytical. Do not give generic statements like "competition is intense."
* Use plain English, but with precision.
* If exact figures are unavailable, say so clearly and provide the best reasonable directional assessment.
* Focus on what matters for an investor or creditor.

---

# OUTPUT STRUCTURE

## 1. TARGET COMPANY COMPETITIVE OVERVIEW

Start with a concise summary of the target company:

* what it does
* how it makes money
* what its major business lines are
* what customer groups it serves
* what kind of market structure it operates in

  * fragmented
  * concentrated
  * oligopoly
  * regional
  * niche
  * regulated
  * platform-driven
  * capital-intensive
  * commoditized
* what the main forces shaping competition are

Then identify the **top 3–5 competitors overall** that matter most.

For each, briefly explain:

* why this competitor matters
* whether it is a direct, adjacent, substitute, or emerging threat
* which business line(s) it overlaps with
* whether it matters more financially, strategically, or both

---

## 2. TOP COMPETITOR SELECTION

Before doing full profiles, explicitly rank the **top few competitors**.

Create a table with:

* Rank
* Competitor
* Ticker
* Public / Private
* Type of competitor (Direct / Adjacent / Substitute / Emerging)
* Main overlapping business line
* Why it matters
* Financial relevance
* Strategic threat level
* Reason for inclusion in the top group

Limit full deep-dive profiles to the **top 3–5 competitors** that matter most.

---

## 3. DEEP BUSINESS PROFILE FOR EACH TOP COMPETITOR

For each selected competitor, provide a **full business profile** using the format below.

### A. Competitor overview

* company name
* ticker if public
* headquarters
* public or private
* ownership / sponsor if private
* short description of what the company does
* main business lines
* major customer groups
* core geographies
* approximate revenue scale
* approximate employee base / fleet / locations / network / units / users, as relevant

### B. Business model

Explain in plain English:

* how the competitor makes money
* what products or services drive the economics
* whether revenue is transactional, recurring, contractual, usage-based, asset-based, or mixed
* what the cost structure looks like
* what the major value drivers are
* whether the model is scale-driven, brand-driven, technology-driven, asset-driven, or relationship-driven
* whether the business is capital intensive
* whether margins are structurally attractive or pressured

### C. Operating segments / business lines

Break the competitor down into its real business units.

For each major business line:

* what it does
* who it serves
* how important it appears to be
* whether it is growing, mature, shrinking, or structurally challenged
* how directly it overlaps with the target company

### D. Competitive position versus the target company

Explain:

* where this competitor overlaps directly with the target company
* where it competes differently
* whether it is broader, narrower, more premium, lower cost, more specialized, more regional, or more diversified
* differences in:

  * product mix
  * customer base
  * pricing model
  * distribution / go-to-market
  * geographic footprint
  * service quality
  * technology
  * brand
  * scale
  * capital intensity
  * regulatory positioning

### E. Relative scale and market position

Discuss:

* approximate size relative to the target company
* relative market share where available
* whether it is a leader, challenger, niche player, consolidator, premium player, low-cost player, or disruptor
* whether it appears to be gaining, stable, or losing position
* what its real strategic importance is in the market

### F. Economics and profitability profile

Discuss, to the extent publicly available:

* revenue size
* segment size if available
* margins
* capital intensity
* fleet / asset utilization / occupancy / same-store metrics / unit economics, as relevant
* operating leverage
* cyclicality
* balance-sheet strength or weakness
* whether profitability appears structurally stronger or weaker than the target company

### G. Strategy and recent direction

Explain:

* recent strategic priorities
* major investments
* acquisitions / divestitures
* technology or product initiatives
* capacity additions or reductions
* management commentary on competition
* whether the company appears to be strengthening or weakening its position

### H. SWOT analysis

Provide a real SWOT analysis for this competitor.

#### Strengths

* structural advantages
* scale advantages
* brand
* network / footprint
* balance sheet
* customer relationships
* technology
* cost position
* regulatory advantage
* distribution reach
* asset base

#### Weaknesses

* structural disadvantages
* weaker balance sheet
* lower margins
* customer concentration
* legacy exposure
* geographic gaps
* operational complexity
* weaker brand
* capital intensity
* execution risk

#### Opportunities

* market share gains
* consolidation
* adjacencies
* product expansion
* pricing
* cost takeout
* digital / technology improvement
* geographic expansion
* competitor weakness
* favorable regulation

#### Threats

* pricing pressure
* substitution
* disruptive entrants
* technology shifts
* regulation
* oversupply
* labor issues
* capital constraints
* recession / cyclical pressure
* customer behavior changes

### I. Credit / investor relevance

For each competitor, explain:

* why this competitor matters for understanding the target company
* whether it pressures price, margins, growth, retention, or capital allocation
* whether it is a risk to the target's downside case
* whether it could take share, compress returns, or force investment
* whether it represents a benchmark the target struggles against or a weaker peer the target may outperform

---

## 4. COMPETITOR COMPARISON TABLE

Create a side-by-side comparison table for the target company and the top competitors.

Columns:

* Company
* Ticker
* Public / Private
* Main overlapping segment
* Approximate size
* Geographic footprint
* Customer focus
* Market position
* Business model
* Key strength
* Key weakness
* Margin / cost position
* Strategic threat level
* Why it matters

---

## 5. COMPETITIVE SYNTHESIS

After reviewing the top few competitors, answer:

* Who are the most important competitors overall?
* Which competitors matter most financially?
* Which matter most strategically?
* Which competitor is most dangerous over the next 3–5 years?
* Which competitor has the strongest business model?
* Which competitor has the strongest balance sheet or staying power?
* Which competitor appears best positioned operationally?
* Which competitor is most vulnerable?
* Which competitor is most likely to gain share?
* Which competitor is most likely to create pricing pressure?
* Where is the target company stronger than peers?
* Where is the target company weaker?
* Is the target company competing from a position of strength, parity, or weakness?

---

## 6. SEGMENT-LEVEL THREAT MAP

Break the target company into its major business lines and identify:

* which competitor is strongest in each segment
* which competitor is most disruptive in each segment
* where the target company has an advantage
* where the target company is most exposed
* whether each segment is structurally attractive or unattractive

---

## 7. EMERGING / NON-TRADITIONAL COMPETITORS

Identify credible emerging threats, including:

* startups
* venture-backed companies
* private operators
* adjacent players entering the market
* substitute offerings
* technology-enabled challengers
* foreign entrants if relevant

For each one, explain:

* what they are doing
* why they matter
* whether they are credible now or later
* which segment they threaten
* whether they threaten price, customer retention, growth, or margins

---

## 8. RESOURCE GUIDE FOR FURTHER RESEARCH

Provide a categorized list of the best sources to research these competitors further.

Include:

* SEC filings
* annual reports
* investor presentations
* earnings calls
* private company sources
* industry trade associations
* industry data providers
* regulatory databases
* customer review sources
* fleet / pricing / utilization trackers or equivalent industry-specific sources
* trade publications
* government procurement databases
* antitrust or merger materials
* expert network topics

For each category, explain:

* what it is useful for
* what it can reveal
* its main limitations

---

## 9. KEY OPEN QUESTIONS

End with the most important unanswered questions for deeper diligence, such as:

* true market share by segment
* pricing differences
* churn / retention differences
* service-quality differences
* margin differences
* customer concentration
* regional strength / weakness
* asset utilization differences
* hidden competitive advantages
* areas where private competitors may be stronger than public disclosures suggest

---

# ANALYTICAL REQUIREMENTS

Please do all of the following:

* Do not just provide a competitor list.
* Do not stop at the target company's reported segments if the real market competes differently.
* Focus on the **top few competitors that really matter**.
* Build **deep business profiles**, not shallow peer summaries.
* Include **SWOT analysis** for each major competitor.
* Highlight where each competitor is stronger than the target company.
* Highlight where the target company may still have an advantage.
* Distinguish between scale, economics, brand, technology, service, and capital structure advantages.
* Discuss both present competition and future competitive risk.
* Be honest where information is unavailable.
* Use estimated / directional language where appropriate, but label it clearly.

---

# SOURCE PREFERENCES

Prioritize:

1. Latest 10-K, 10-Q, annual report, proxy of the target company
2. Competitor filings, annual reports, investor presentations, and earnings calls
3. Management commentary on competitive dynamics
4. Industry reports, trade associations, and trade journals
5. Regulatory data and government sources
6. Reputable press coverage and expert commentary
7. Private company and startup databases where relevant

Do not rely primarily on generic finance websites.
Do not just list peer companies from screeners.
Do not give a shallow overview.
I want a real understanding of the **top competitors as businesses**.

---

# STYLE

* Be comprehensive, specific, and analytical
* Use plain English
* Avoid fluff and generic consultant language
* Focus on what matters for an investor or creditor
* Be explicit about what is fact, what is estimated, and what is judgment`;
