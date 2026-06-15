/**
 * Credit Decision Dashboard — structured JSON decision page for credit analysts.
 */

const CREDIT_DECISION_DASHBOARD_SCHEMA = `{
  "credit_verdict": {
    "recommendation": "Buy|Hold|Pass|Short|Watchlist",
    "confidence": "High|Medium|Low",
    "one_line_thesis": "bullet string",
    "one_line_bear_case": "bullet string",
    "why_it_works": ["bullet"],
    "why_it_fails": ["bullet"]
  },
  "security_snapshot": {
    "company": "",
    "ticker": "",
    "security": "",
    "price": "",
    "maturity": "",
    "coupon": "",
    "ranking": "",
    "yield_spread": "",
    "guarantor_support": "",
    "collateral_support": "",
    "claims_ahead": ["bullet"],
    "claims_behind": ["bullet"],
    "key_structural_issue": "bullet string"
  },
  "core_credit_thesis": ["5-10 substantive bullets"],
  "core_bear_case": ["5-10 substantive bullets"],
  "must_be_true_assumptions": [{
    "assumption": "",
    "why_it_matters": "",
    "evidence_supporting": ["bullet"],
    "evidence_against": ["bullet"],
    "fragility": "Low|Medium|High",
    "what_would_break_it": ""
  }],
  "key_risks": [{
    "category": "",
    "risk": "",
    "why_it_matters": "",
    "time_horizon": "Near-term|Long-term|Medium-term",
    "severity": "Low|Medium|High",
    "probability": "Low|Medium|High",
    "indicator_to_monitor": ""
  }],
  "downside_scenarios": [{
    "case_name": "Mild Bear Case|Severe Bear Case|Zero / Disaster Case",
    "what_happens": ["bullet"],
    "revenue_ebitda_impact": ["bullet"],
    "liquidity_impact": ["bullet"],
    "security_price_impact": ["bullet"],
    "recovery_implication": ["bullet"]
  }],
  "recovery_view": {
    "summary": ["bullet"],
    "bull_case": "",
    "base_case": "",
    "bear_case": "",
    "severe_bear_case": "",
    "biggest_upside_factor": "",
    "biggest_downside_factor": ""
  },
  "liquidity_refinancing_view": {
    "summary": ["bullet"],
    "liquidity_rating": "comfortable|manageable|tight|stressed|critical",
    "refinancing_risk": "",
    "restructuring_probability": "",
    "key_maturity_issue": ""
  },
  "lme_risk": {
    "risk_rating": "Low|Medium|High",
    "summary": ["bullet"],
    "most_likely_creditor_unfriendly_transaction": ""
  },
  "management_credibility": {
    "rating": "Strong|Acceptable|Mixed|Weak|Poor",
    "summary": ["bullet"]
  },
  "market_blind_spots": ["bullet"],
  "what_would_make_us_buy_more": ["bullet"],
  "what_would_make_us_sell_or_short": ["bullet"],
  "monitoring_dashboard": [{
    "category": "",
    "indicator": "",
    "bullish_signal": "",
    "bearish_signal": "",
    "source_to_monitor": ""
  }],
  "final_decision": {
    "recommendation": "Buy|Hold|Pass|Short|Watchlist",
    "confidence": "High|Medium|Low",
    "target_price_or_recovery": "",
    "downside_price_estimate": "",
    "expected_time_horizon": "",
    "key_catalyst": "",
    "biggest_risk": "",
    "what_would_change_the_view": ""
  },
  "missing_information": ["bullet describing gaps and why they matter"]
}`;

const CREDIT_DECISION_DASHBOARD_BODY = `You are a senior credit analyst building a **Credit Decision Dashboard** — a concise, decision-useful page (not a long memo).

Answer: **"At the current security price, should a credit analyst buy, pass, short, or keep watching this credit?"**

## Analyst inputs (may be partial)
- Company: [INSERT COMPANY NAME]
- Ticker / workspace: [INSERT TICKER]
- Security analyzed: [INSERT SECURITY]
- Current price: [INSERT PRICE]
- Yield / spread: [INSERT YIELD SPREAD]
- Maturity: [INSERT MATURITY]
- Coupon: [INSERT COUPON]
- Security ranking: [INSERT RANKING]
- Analyst current view: [INSERT ANALYST VIEW]
- Analyst notes / override: [INSERT ANALYST NOTES]

## Source materials
Use ONLY the provided saved research (memos, response boxes, work products, ingested files). **Synthesize** — do not concatenate or summarize file-by-file.

Prioritize: credit memo, capital structure, covenant / debt docs, LME analysis, risk analysis, recent events, earnings transcript work, bear-case memos, recovery views.

If a section lacks support in saved materials:
- Use bullets like: "Not enough information in saved materials."
- Add specific gaps to \`missing_information\`.

## Output rules (critical)
1. Return **ONLY valid JSON** matching the schema below. No markdown wrapper, no prose outside JSON.
2. **All narrative content must be bullet strings** in arrays, or single bullet strings in string fields. No long paragraphs.
3. Each bullet should contain: **claim + evidence/rationale + why it matters for credit**.
4. Distinguish **facts** (from sources) vs **inferences** (label as inference).
5. Be company- and security-specific. Avoid generic credit boilerplate.
6. Think as both a long credit investor and a distressed short analyst.
7. Do not hallucinate covenant terms, prices, or filings not supported by materials.
8. Prefer recent saved work when sources conflict.
9. Include source hints in bullets where possible (e.g. "per capital-structure.txt …").
10. Populate all schema keys; use empty arrays or "Not enough information in saved materials." when needed.

## Dashboard sections (inside JSON)
A. credit_verdict — recommendation, confidence, thesis, bear case, why it works/fails
B. security_snapshot — specific security context
C. core_credit_thesis — 5–10 bullets
D. core_bear_case — 5–10 bullets
E. must_be_true_assumptions — table rows
F. key_risks — grouped by category with severity/probability
G. downside_scenarios — exactly 3 cases: Mild Bear, Severe Bear, Zero/Disaster
H. recovery_view — bull/base/bear/severe bear recovery ranges (estimate if needed, label estimates)
I. liquidity_refinancing_view — runway, maturities, refinancing/restructuring odds
J. lme_risk — priming, uptier, asset leakage, non-pro-rata risks
K. management_credibility — guidance track record, add-backs, creditor-friendliness
L. market_blind_spots
M. what_would_make_us_buy_more
N. what_would_make_us_sell_or_short
O. monitoring_dashboard — checklist with bull/bear signals
P. final_decision — clean decision box
Q. missing_information — gaps and recommended next steps

## JSON schema
${CREDIT_DECISION_DASHBOARD_SCHEMA}`;

export function buildCreditDecisionDashboardSystemPrompt(
  ticker: string,
  inputs: {
    companyName?: string;
    securityAnalyzed?: string;
    currentPrice?: string;
    currentYieldSpread?: string;
    maturity?: string;
    coupon?: string;
    securityRanking?: string;
    analystView?: string;
    analystNotes?: string;
  }
): string {
  const tk = ticker.trim().toUpperCase();
  return CREDIT_DECISION_DASHBOARD_BODY.replace("[INSERT COMPANY NAME]", inputs.companyName?.trim() || tk)
    .replace("[INSERT TICKER]", tk)
    .replace("[INSERT SECURITY]", inputs.securityAnalyzed?.trim() || "(not specified)")
    .replace("[INSERT PRICE]", inputs.currentPrice?.trim() || "(not specified)")
    .replace("[INSERT YIELD SPREAD]", inputs.currentYieldSpread?.trim() || "(not specified)")
    .replace("[INSERT MATURITY]", inputs.maturity?.trim() || "(not specified)")
    .replace("[INSERT COUPON]", inputs.coupon?.trim() || "(not specified)")
    .replace("[INSERT RANKING]", inputs.securityRanking?.trim() || "(not specified)")
    .replace("[INSERT ANALYST VIEW]", inputs.analystView?.trim() || "(not specified)")
    .replace("[INSERT ANALYST NOTES]", inputs.analystNotes?.trim() || "(none)");
}

export function buildCreditDecisionDashboardUserPrompt(params: { inventory: string; materials: string }): string {
  return `
# FILE / MATERIAL INVENTORY
${params.inventory}

# SAVED RESEARCH MATERIALS (primary basis — synthesize across all)
${params.materials}

---
Return ONLY the JSON object matching the schema in your system instructions.
`.trim();
}
