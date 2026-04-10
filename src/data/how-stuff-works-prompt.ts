/**
 * HowStuffWorks tab — operating-diligence prompt. Replace placeholders in the UI / bulk runner.
 */

export const HOW_STUFF_WORKS_OPTIONAL_PRODUCTS_FALLBACK =
  "(Not specified — infer primary products/services from public disclosures.)";

export function fillHowStuffWorksPromptPlaceholders(
  tpl: string,
  companyName: string,
  ticker: string
): string {
  return tpl
    .replace(/\[INSERT COMPANY NAME\]/g, companyName)
    .replace(/\[INSERT TICKER\]/g, ticker)
    .replace(/\[OPTIONAL — INSERT IF KNOWN\]/g, HOW_STUFF_WORKS_OPTIONAL_PRODUCTS_FALLBACK);
}

export const HOW_STUFF_WORKS_PROMPT_TEMPLATE = `You are a meticulous operating-diligence analyst.

I will provide a company name and ticker. Your job is to reverse engineer, in as much practical detail as possible, **how this business actually works on the ground**.

I do **not** want a generic company overview.
I want this written **like a real operator, competitor, or private equity operating partner trying to replicate, attack, or rebuild the business from scratch**.

## Company

* **Company name:** [INSERT COMPANY NAME]
* **Ticker:** [INSERT TICKER]
* **Primary products/services to investigate:** [OPTIONAL — INSERT IF KNOWN]

## Objective

Build a **full operating blueprint** of how this company creates, develops, sources, manufactures or delivers, markets, sells, services, and monetizes its product or service.

I want to understand the business from the perspective of:

1. **How the product is actually made or delivered**
2. **What functions must exist to make the business work**
3. **What capabilities, people, systems, assets, contracts, and know-how are required**
4. **What a serious new entrant would need to replicate in order to compete**
5. **Where the real bottlenecks, hidden advantages, and fragile points are**

This should read like an **operator's field manual**, not an investor pitch.

---

## Core instructions

### 1. Start with the product and work backward to the inputs

For each major product or service line, explain in detail:

* What the end product/service actually is
* Who the customer is
* What problem it solves
* What physical or digital inputs are required
* Where those inputs come from
* How they are processed, refined, transformed, assembled, coded, maintained, or delivered
* How those inputs ultimately become part of the final product/service

If the company uses **raw materials**, explain:

* the key raw materials
* who supplies them
* how they are refined or processed before use
* what specifications matter
* how procurement works
* how supply risk is managed
* whether input costs are volatile
* whether the company has bargaining power, long-term contracts, dual sourcing, spot buying, etc.

If the company is **software**, translate "raw materials" into:

* engineering talent
* product requirements
* code base
* infrastructure
* data
* third-party APIs
* developer tools
* cloud architecture
* security layers
* implementation resources

If the company is **asset-heavy or service-heavy** (e.g. car rental, logistics, hospitals, telecom, etc.), explain:

* how assets are sourced
* how assets are deployed
* how they are maintained
* how capacity is managed
* how utilization is optimized
* how pricing is set in real time
* how assets are remarketed or disposed of at the end of useful life

---

### 2. Break the company into its major operating functions

I want the company decomposed into the major functional building blocks required to run it.

For each function, explain:

* what the function actually does day to day
* where it sits in the workflow
* what decisions it makes
* what systems/tools it uses
* what KPIs matter
* what skills or labor are needed
* what mistakes can damage the business
* how this function interacts with the rest of the company

At minimum, analyze the relevant functions below and adapt them to the business:

* Product design / product management
* R&D / engineering / formulation / development
* Sourcing / procurement
* Manufacturing / implementation / service delivery
* Quality assurance / testing / compliance
* Supply chain / logistics / inventory management
* Marketing
* Sales
* Pricing / revenue management
* Customer onboarding / customer success / account management
* Maintenance / servicing / repair / support
* Distribution / channel management
* Retailer or partner negotiations
* Legal / regulatory / contracting
* IT / data / internal systems
* Finance operations where operationally relevant
* Asset resale / remarketing / end-of-life management, if applicable

Do **not** treat these as abstract corporate boxes. Explain how they actually function in practice.

---

### 3. Explain the workflow in sequence

Lay out the business as a **step-by-step operational chain**.

For example:

* input sourcing
* design/specification
* testing/validation
* production or deployment
* inventory/storage
* customer acquisition
* contract negotiation
* delivery/onboarding
* service/maintenance/support
* renewal/repeat purchase
* disposition or replacement

I want to see **how work moves through the business**, not just a list of departments.

For each step, explain:

* who does it
* what information is needed
* what systems or assets are involved
* where bottlenecks arise
* where economics are won or lost

---

### 4. Make this specific to the company, not generic to the industry

Use the company's actual public disclosures, interviews, trade sources, industry publications, supplier/customer commentary, job postings, employee reviews, conference transcripts, technical papers, regulatory filings, procurement documents, customer case studies, and channel checks where available.

I want you to infer and reconstruct how the company operates in practice, but every important claim should be grounded in evidence or clearly labeled inference.

Separate clearly:

* **What is directly evidenced**
* **What is strongly inferred**
* **What remains uncertain**

---

### 5. Include the real commercial mechanics

I care a lot about how the company **actually gets paid** and how the commercial engine works.

Explain in detail:

* pricing model
* contract structure
* discounting behavior
* rebate or promotional structure
* channel economics
* retailer terms
* commissions / compensation design
* quota structure if sales-led
* implementation fees / service fees / upsell mechanics
* working capital implications
* who has leverage in negotiations
* renewal, churn, repeat purchase, or remarketing dynamics

Do not just say "the company sells through direct and indirect channels."
I want the real mechanics.

---

### 6. Force industry-specific operating detail

Adapt the analysis depending on the business model.

#### If this is a software company, include:

* product architecture
* cloud or on-prem deployment model
* engineering talent needs
* product roadmap process
* release cycle
* QA / DevOps / SRE / security requirements
* implementation/onboarding process
* pricing terms: seat-based, usage-based, module-based, enterprise license, minimum commits, overage, services
* sales structure: field sales, inside sales, partner-led, PLG, channel
* compensation mechanics: quota, ramp, commission rates, accelerators, renewals credit, SE support
* customer acquisition cost drivers
* retention / expansion mechanics
* support organization and SLA structure

#### If this is a consumer products company, include:

* formulation / bill of materials / ingredients / packaging inputs
* own manufacturing vs co-manufacturing
* sourcing geography
* retailer pitch process
* how buyer conversations with Walmart / Target / Amazon / Costco / grocery chains likely work
* trade promotions
* slotting / placement / end caps / feature ads / digital shelf
* category management
* merchandising
* returns / spoilage / fill rate / OTIF
* promotional calendar
* margin split between manufacturer, distributor, and retailer
* new product introduction process

#### If this is a car rental or fleet-based company, include:

* OEM sourcing contracts
* risk vs risk-free fleet economics
* repurchase / program car mechanics if relevant
* how fleet mix is decided
* how rental pricing is set
* airport vs off-airport economics
* concession RFP process
* major airport concession contract terms
* labor and staffing model at branches/airports
* maintenance, cleaning, repair, reconditioning
* telematics / fleet systems
* damage management
* vehicle disposition / wholesale / retail / auctions
* how residual values affect the model
* utilization management and seasonality

#### If this is another kind of company, infer the equivalent operator-level modules and go just as deep.

---

### 7. Show what a competitor would need to build

After explaining how the company works, answer this question:

**If I wanted to replicate this business and compete seriously, what exact capabilities would I need to assemble?**

Break this into:

* people
* systems
* suppliers
* facilities or infrastructure
* contracts
* distribution access
* technical know-how
* regulatory approvals
* working capital
* data
* customer relationships
* brand or reputation requirements

Then explain:

* what is easy to copy
* what is hard to copy
* what takes time
* what requires scale
* what requires trust/relationships
* what depends on incumbency or regulation
* what hidden advantages the incumbent may have

---

### 8. Identify bottlenecks, failure points, and non-obvious advantages

I want a serious section on:

* operational bottlenecks
* critical dependencies
* hidden fragilities
* major execution risks
* where margins leak out
* what can go wrong in sourcing, production, sales, service, or distribution
* where scale matters
* where software/data matters
* where relationships matter
* where brand matters
* where regulation matters
* where the company may appear stronger than it is
* where the company may actually be more defensible than outsiders think

---

### 9. Quantify wherever possible

I want numbers, not vague statements, whenever the data is available or can be reasonably estimated.

Use:

* unit economics
* margin structure
* cost buckets
* pricing ranges
* supplier concentration
* headcount composition where relevant
* sales productivity metrics
* inventory turns
* utilization rates
* maintenance costs
* conversion rates
* trade spend
* revenue per customer / per asset / per rep / per SKU / per location
* contract duration
* working capital cycle
* capex intensity
* R&D intensity
* cost to serve

If precise numbers are unavailable, provide informed ranges and explain the basis.

---

## Required output format

Use this structure:

### 1. Executive operating summary

A concise summary of how the business actually works and where the economic engine really sits.

### 2. Product/service blueprint

What the company sells, how the offering works, what customers are buying, and what inputs are required.

### 3. End-to-end operational chain

A sequential walkthrough from inputs to final monetization.

### 4. Functional breakdown

A detailed section for each major function in the company and how it operates in practice.

### 5. Commercial engine

Pricing, contracts, sales motion, channels, promotions, compensation, and revenue mechanics.

### 6. Industry-specific operator detail

Go deep on the company-specific mechanics relevant to this business model.

### 7. Replication playbook

What a new entrant would have to build to compete.

### 8. Bottlenecks, risks, and hidden advantages

Operational failure points, moat analysis, and fragile areas.

### 9. Key metrics and economics

All relevant numerical measures, ranges, and unit economics.

### 10. Open questions and highest-value missing information

What remains uncertain, and what additional channel checks or documents would most improve the analysis.

---

## Quality bar

Do not give me a shallow summary.

I want:

* detailed
* concrete
* operator-level
* commercially aware
* specific to the company
* grounded in evidence
* explicit about uncertainty
* focused on how the machine actually runs

Avoid generic MBA language.
Avoid vague phrases like "the company focuses on innovation" unless you explain exactly what that means operationally.

Write this like someone trying to **build, compete with, diligence, or fix the business**.
`;
