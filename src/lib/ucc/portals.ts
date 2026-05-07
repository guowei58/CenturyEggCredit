export type UccSearchMethod = "manual" | "paid" | "blocked" | "api" | "portal_automation";

export type UccJurisdictionMeta = {
  jurisdiction: string;
  ucc_portal_url: string;
  search_method: UccSearchMethod;
  requires_login: boolean;
  requires_payment: boolean;
  captcha_detected: boolean;
  automation_allowed: boolean | "unknown";
  notes: string;
};

/**
 * Curated state portal links (manual search).
 *
 * Source: table compiled from state filing office resources (see internal ops list / docs).
 * Fallback remains the NASS directory when a state isn’t mapped yet.
 */
const UCC_PORTAL_OVERRIDES: Partial<Record<string, string>> = {
  AL: "https://www.sos.alabama.gov/business-services",
  AK: "https://dnr.alaska.gov/ssd/recoff/ucc",
  AZ: "https://azsos.gov/business/ucc",
  AR: "https://www.sos.arkansas.gov/business-commercial-services-bcs/uniform-commercial-code-ucc/",
  CA: "https://www.sos.ca.gov/",
  CO: "https://www.sos.state.co.us/ucc/pages/home.xhtml",
  CT: "https://portal.ct.gov/sots/business-services/bsd",
  DE: "https://corp.delaware.gov/uccauthsrch/",
  FL: "https://dos.fl.gov/sunbiz/other-services/ucc-information/",
  GA: "https://www.gsccca.org/",
  HI: "https://dlnr.hawaii.gov/boc/",
  IL: "https://www.ilsos.gov/departments/business-services/uniform-commercial-code/ucc-instructions.html",
  IN: "https://secure.in.gov/sos/business/ucc/",
  IA: "https://sos.iowa.gov/businesses/uniform-commercial-code-ucc",
  KS: "https://sos.ks.gov/general-services/ucc.html",
  // KY URL in source list can include a session path; keep users on the start page.
  KY: "https://web.sos.ky.gov/ftucc/",
  // Decode HTML entity from upstream copy/paste.
  LA: "https://sso.sos.la.gov/CreateAccount/signOn.aspx?AppCode=UCCF&ReturnURL=https://uccfilings.sos.la.gov/UCC_Home.aspx",
  ME: "https://apps1.web.maine.gov/cgi-bin/online/ucc/index.pl",
  MD: "https://dat.maryland.gov/businesses/pages/ucc-instructions-for-maryland.aspx",
  MA: "https://www.sec.state.ma.us/divisions/corporations/filing-by-subject/ucc/corporations-uniform-commercial-code.htm",
  MS: "https://business.sos.ms.gov/star/portal/ucc/page/login/portal.aspx",
  MT: "https://biz.sosmt.gov/auth?from=/forms/new/1000",
  NJ: "https://www.nj.gov/treasury/revenue/fileucc.shtml",
  NM: "https://www.sos.nm.gov/commercial-services/ucc-filings/",
  NY: "https://appext20.dos.ny.gov/pls/efiling_public/ucc_app.eucc.eucc1_frm?pbutton=Reset",
  ND: "https://cis.sos.nd.gov/",
  OK: "https://www.oklahomacounty.org/county-information/uniform-commercial-code-ucc",
  RI: "https://business.sos.ri.gov/uccfiling/ucc/uccmenu.aspx?FilingMethod=I",
  SC: "https://ucconline.sc.gov/UCCFiling/UCCMainPage.aspx",
  VT: "https://bizfilings.vermont.gov/login",
  WA: "https://fortress.wa.gov/dol/ucc/",
  WV: "https://apps.wv.gov/sos/ucc/",
  WI: "https://dfi.wi.gov/Pages/BusinessServices/UCC/GeneralInformation.aspx",
  WY: "https://corp.delaware.gov/uccsearch/",
};

export function uccPortalUrlForState(state: string): string {
  const st = state.trim().toUpperCase();
  const directory = "https://www.nass.org/business-services/ucc-search";
  if (!/^[A-Z]{2}$/.test(st)) return directory;
  return UCC_PORTAL_OVERRIDES[st] ?? `${directory}#${encodeURIComponent(st)}`;
}

/**
 * MVP: provide an official directory URL for all states; state-by-state portals can be
 * filled in later as the team validates terms + automation feasibility.
 */
export function uccJurisdictionMeta(state: string): UccJurisdictionMeta {
  const st = state.trim().toUpperCase();
  const directory = "https://www.nass.org/business-services/ucc-search";
  if (!/^[A-Z]{2}$/.test(st)) {
    return {
      jurisdiction: st || "—",
      ucc_portal_url: directory,
      search_method: "manual",
      requires_login: false,
      requires_payment: false,
      captcha_detected: false,
      automation_allowed: "unknown",
      notes: "Unknown/invalid state code; use the directory to locate the correct UCC search portal.",
    };
  }
  return {
    jurisdiction: st,
    ucc_portal_url: uccPortalUrlForState(st),
    search_method: "manual",
    requires_login: false,
    requires_payment: false,
    captcha_detected: false,
    automation_allowed: "unknown",
    notes: "MVP: manual search via official directory. Add state-specific portals/automation after terms validation.",
  };
}

