/** Structured payload for Credit Decision Dashboard (matches AI output schema). */

export type CreditDecisionRecommendation =
  | "Buy"
  | "Hold"
  | "Pass"
  | "Short"
  | "Watchlist"
  | string;

export type CreditDecisionConfidence = "High" | "Medium" | "Low" | string;

export type CreditDecisionDashboardPayload = {
  credit_verdict: {
    recommendation: CreditDecisionRecommendation;
    confidence: CreditDecisionConfidence;
    one_line_thesis: string;
    one_line_bear_case: string;
    why_it_works: string[];
    why_it_fails: string[];
  };
  security_snapshot: {
    company: string;
    ticker: string;
    security: string;
    price: string;
    maturity: string;
    coupon: string;
    ranking: string;
    yield_spread?: string;
    guarantor_support: string;
    collateral_support: string;
    claims_ahead: string[];
    claims_behind: string[];
    key_structural_issue: string;
  };
  core_credit_thesis: string[];
  core_bear_case: string[];
  must_be_true_assumptions: Array<{
    assumption: string;
    why_it_matters: string;
    evidence_supporting: string[];
    evidence_against: string[];
    fragility: string;
    what_would_break_it: string;
  }>;
  key_risks: Array<{
    category: string;
    risk: string;
    why_it_matters: string;
    time_horizon: string;
    severity: string;
    probability: string;
    indicator_to_monitor: string;
  }>;
  downside_scenarios: Array<{
    case_name: string;
    what_happens: string[];
    revenue_ebitda_impact: string[];
    liquidity_impact: string[];
    security_price_impact: string[];
    recovery_implication: string[];
  }>;
  recovery_view: {
    summary: string[];
    bull_case: string;
    base_case: string;
    bear_case: string;
    severe_bear_case: string;
    biggest_upside_factor: string;
    biggest_downside_factor: string;
  };
  liquidity_refinancing_view: {
    summary: string[];
    liquidity_rating: string;
    refinancing_risk: string;
    restructuring_probability: string;
    key_maturity_issue: string;
  };
  lme_risk: {
    risk_rating: string;
    summary: string[];
    most_likely_creditor_unfriendly_transaction: string;
  };
  management_credibility: {
    rating: string;
    summary: string[];
  };
  market_blind_spots: string[];
  what_would_make_us_buy_more: string[];
  what_would_make_us_sell_or_short: string[];
  monitoring_dashboard: Array<{
    category: string;
    indicator: string;
    bullish_signal: string;
    bearish_signal: string;
    source_to_monitor: string;
  }>;
  final_decision: {
    recommendation: CreditDecisionRecommendation;
    confidence: CreditDecisionConfidence;
    target_price_or_recovery: string;
    downside_price_estimate: string;
    expected_time_horizon: string;
    key_catalyst: string;
    biggest_risk: string;
    what_would_change_the_view: string;
  };
  missing_information: string[];
};

export type CreditDecisionDashboardInputs = {
  companyName: string;
  ticker: string;
  securityAnalyzed: string;
  currentPrice: string;
  currentYieldSpread: string;
  maturity: string;
  coupon: string;
  securityRanking: string;
  analystView: CreditDecisionRecommendation | "";
  analystNotes: string;
};

export const EMPTY_CREDIT_DECISION_DASHBOARD_INPUTS: CreditDecisionDashboardInputs = {
  companyName: "",
  ticker: "",
  securityAnalyzed: "",
  currentPrice: "",
  currentYieldSpread: "",
  maturity: "",
  coupon: "",
  securityRanking: "",
  analystView: "",
  analystNotes: "",
};
