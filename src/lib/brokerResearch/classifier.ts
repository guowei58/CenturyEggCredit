import type { BrokerAccessLevel, BrokerDefinition, BrokerReportType } from "./types";
import { hostnameOf, normalizeTitleForMatch } from "./utils";

function hay(title: string, snippet: string, url: string): string {
  return `${title} ${snippet} ${url}`.toLowerCase();
}

export function classifyReportType(title: string, snippet: string, url: string): BrokerReportType {
  const h = hay(title, snippet, url);

  if (/research\s*portal|client\s*access|institutional\s*login|sso|sign\s*in\s*to\s*view/i.test(h)) {
    return "research_portal";
  }
  if (/\/login|\/signin|\/auth|client\s*login/i.test(url)) {
    return "research_portal";
  }

  if (/\bthematic\b/i.test(h) && !/\bsector\b|\bindustry\b/i.test(h)) return "thematic_note";
  if (/\bsector\b|\bindustry\b|\bgroup\b\s*(note|update|view)/i.test(h)) return "sector_note";

  if (/\binitiat(e|es|ion|ed)\b|\binitiation\b/i.test(h)) return "initiation";
  if (/\bdowngrade(s|d)?\b|\bcuts?\s+(to|price|rating)\b|\blower(s|ed)?\s+(to|rating|pt)\b/i.test(h)) {
    return "downgrade";
  }
  if (/\bupgrade(s|d)?\b|\braises?\s+(to|price|rating|target)\b|\blift(s|ed)?\s+(to|pt)\b/i.test(h)) {
    return "upgrade";
  }
  if (/\brating\s+change\b|\breiterat(es|ed)\b|\bnotch(es|ed)?\b|\bmaintain(s|ed)?\b/i.test(h)) {
    return "rating_change";
  }

  if (/\bprice\s*target\b|\btarget\s*price\b|\bpt\s+to\b|\bpt\s+of\b/i.test(h)) {
    return "target_price_change";
  }

  if (/\bpreview\b|\bpreviewing\b|\bahead\s+of\s+earnings\b/i.test(h)) return "earnings_preview";
  if (/\brecap\b|\bpost[-\s]?earnings\b|\bresults\s+review\b|\bearnings\s+wrap\b/i.test(h)) {
    return "earnings_recap";
  }

  if (/\bcompany\s+update\b|\bstock\s+update\b|\bcoverage\s+update\b/i.test(h)) return "company_update";

  if (/\binsight(s)?\b|\bviews\b|\banalysis\b/i.test(h) && !/research\s*portal/i.test(h)) {
    return "public_insight";
  }

  if (/\/research\/?$/i.test(url) || /research\s+home/i.test(h)) return "research_landing_page";

  return "unknown";
}

export function classifyAccessLevel(title: string, snippet: string, url: string): BrokerAccessLevel {
  const h = hay(title, snippet, url);
  if (/subscriber|subscription|paywall|entitled\s+clients|institutional\s+clients\s+only/i.test(h)) {
    return "subscription_likely";
  }
  if (
    /login|sign\s*in|sso|client\s*portal|research\s*portal|authenticate|password/i.test(h) &&
    !/\bfree\b|\bpublic\b/i.test(h)
  ) {
    return "login_required";
  }
  if (/\/login|\/signin|\/auth|\/portal\/|secure\./i.test(url)) {
    return "login_required";
  }
  if (/\b(open\s+access|public\s+article|free\s+to\s+read)\b/i.test(h)) return "public";
  if (/insight|blog|article|newsroom|press/i.test(h) && !/portal|login/i.test(h)) return "public";
  return "unknown";
}

export function buildSupportingSignals(args: {
  broker: BrokerDefinition;
  title: string;
  snippet: string;
  url: string;
  ticker: string;
  companyName?: string;
}): string[] {
  const sig: string[] = [];
  const blob = `${args.title} ${args.snippet}`.toLowerCase();
  const tk = args.ticker.trim().toUpperCase();
  if (blob.includes(tk.toLowerCase())) sig.push("ticker_in_text");
  const cn = args.companyName?.trim();
  if (cn && normalizeTitleForMatch(blob).includes(normalizeTitleForMatch(cn))) {
    sig.push("company_name_in_text");
  }
  const host = hostnameOf(args.url);
  if (host && args.broker.domains.some((d) => host === d || host.endsWith(`.${d}`))) {
    sig.push("broker_domain_match");
  }
  for (const hint of args.broker.urlHints ?? []) {
    if (args.url.toLowerCase().includes(hint.toLowerCase())) sig.push(`url_hint:${hint}`);
  }
  return sig;
}
