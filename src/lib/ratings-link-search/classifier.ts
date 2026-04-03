import type { AccessLevel, RatingsAgency, RatingsResultType } from "./types";

const AGENCY_BY_DOMAIN: Array<{ suffix: string; agency: RatingsAgency }> = [
  { suffix: "fitchratings.com", agency: "Fitch" },
  { suffix: "fitch.com", agency: "Fitch" },
  { suffix: "moodys.com", agency: "Moody's" },
  { suffix: "moody.com", agency: "Moody's" },
  { suffix: "spglobal.com", agency: "S&P" },
  { suffix: "standardandpoors.com", agency: "S&P" },
];

export function inferAgencyFromUrl(url: string): RatingsAgency | null {
  try {
    const host = new URL(url).hostname.toLowerCase();
    for (const { suffix, agency } of AGENCY_BY_DOMAIN) {
      if (host === suffix || host.endsWith(`.${suffix}`)) return agency;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function isAllowedAgencyDomain(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return AGENCY_BY_DOMAIN.some(({ suffix }) => h === suffix || h.endsWith(`.${suffix}`));
}

const ISSUE_TERMS =
  /\b(note|notes|bond|bonds|debenture|debentures|loan|term loan|tl[a-z]?|revolver|senior unsecured|secured|subordinated|abs|clo|cdo|tranche|instrument|program|programme|facility)\b/i;

const ACTION_TERMS =
  /\b(affirm|affirmed|affirms|downgrade|downgrades|downgraded|upgrade|upgrades|upgraded|withdraw|withdrawn|outlook|revision|revises|watch|review|placed on|criteria report.*rating action|rating action)\b/i;

const ISSUER_TERMS =
  /\b(issuer|issuers|corporate rating|issuer rating|entity rating|cfc|ltfc|counterparty|cfr\b|company rating)\b/i;

const RESEARCH_TERMS =
  /\b(commentary|credit opinion|sector report|cross[- ]sector|research|analysis|report|faq|credit update|creditview|credit overview|special report|outlook report)\b/i;

const COMMENTARY_TERMS =
  /\b(commentary|perspective|podcast|video|blog|insights|briefing|explainer)\b/i;

export function classifyResultType(title: string, snippet: string, url: string): RatingsResultType {
  const blob = `${title}\n${snippet}\n${url}`.toLowerCase();

  if (ACTION_TERMS.test(blob)) {
    return "rating_action";
  }
  if (ISSUER_TERMS.test(blob) && !ISSUE_TERMS.test(blob)) {
    return "issuer_rating";
  }
  if (ISSUE_TERMS.test(blob)) {
    return "issue_rating";
  }
  if (COMMENTARY_TERMS.test(blob) && !RESEARCH_TERMS.test(blob)) {
    return "commentary";
  }
  if (RESEARCH_TERMS.test(blob)) {
    return "research";
  }
  if (/\/research\//i.test(url) || /research|commentary/i.test(url)) {
    return "research";
  }
  if (/\/ratings\//i.test(url) && ACTION_TERMS.test(blob)) {
    return "rating_action";
  }
  return "unknown";
}

export function inferAccessLevel(url: string, agency: RatingsAgency): AccessLevel {
  const u = url.toLowerCase();
  if (/login|signin|sign-in|auth|subscriber|subscription|entitlement|client /i.test(u)) {
    return "login_required";
  }
  if (agency === "S&P" && /ratings\.spglobal|disclosure|ResearchArticle/i.test(u)) {
    return "subscription_likely";
  }
  if (agency === "Moody's" && /shareholder|credinsights|ratings\.moodys/i.test(u)) {
    return "subscription_likely";
  }
  if (agency === "Fitch" && /fitchratings\.com.*(research|rating)/i.test(u)) {
    return "subscription_likely";
  }
  return "unknown";
}

const INSTRUMENT_HINTS: Array<{ re: RegExp; hint: string }> = [
  { re: /\bABS\b/i, hint: "ABS" },
  { re: /\bCLO\b/i, hint: "CLO" },
  { re: /\bCDO\b/i, hint: "CDO" },
  { re: /senior unsecured/i, hint: "Senior unsecured" },
  { re: /secured bond/i, hint: "Secured" },
  { re: /term loan/i, hint: "Term loan" },
  { re: /\bTL[A-Za-z]?\b/, hint: "Term loan" },
  { re: /revolv/i, hint: "Revolving" },
  { re: /subordinated/i, hint: "Subordinated" },
];

export function extractInstrumentHints(title: string, snippet: string): string[] {
  const text = `${title} ${snippet}`;
  const out = new Set<string>();
  for (const { re, hint } of INSTRUMENT_HINTS) {
    if (re.test(text)) out.add(hint);
  }
  return Array.from(out);
}
