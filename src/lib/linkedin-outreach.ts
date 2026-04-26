/**
 * Shared LinkedIn outreach letter (Employee + Industry contacts tabs).
 * Persisted state uses OUTREACH_STORAGE_KEY in localStorage — one set of edits for all tickers.
 */

export const OUTREACH_LETTER_TEMPLATE = `Hi [Name],

I am reaching out because your prior experience at [Company], particularly in [function/business area], seems highly relevant to a research project I am currently working on involving [industry / company / market].

I would welcome the opportunity to speak with you for a brief consultation, ideally 30–60 minutes, to better understand the industry, market dynamics, operating model, and key issues from the perspective of someone with direct experience. I am interested only in your general industry knowledge and personal perspective, and I am not seeking any confidential, proprietary, or material nonpublic information, or anything that would violate any obligations you may owe to a current or former employer.

I would, of course, be happy to compensate you for your time. If you are open to speaking, please let me know your availability and your preferred rate, and I can work around your schedule. I would also be happy to send a short description of the topics in advance.

Thank you for considering it.

Best,
[Your Name]
[Title / Firm, if applicable]
[Email]
[Phone]`;

/** Bump when signature-field defaults should reset for all users (e.g. clear legacy prefills). */
export const OUTREACH_STORAGE_KEY = "cec-linkedin-outreach-v2";

export type LinkedInOutreachState = {
  letterTemplate: string;
  marketLine: string;
  yourName: string;
  yourTitle: string;
  yourEmail: string;
  yourPhone: string;
};

export const DEFAULT_LINKEDIN_OUTREACH_STATE: LinkedInOutreachState = {
  letterTemplate: OUTREACH_LETTER_TEMPLATE,
  marketLine: "",
  yourName: "",
  yourTitle: "",
  yourEmail: "",
  yourPhone: "",
};

const SALUTATION_HONORIFIC = /^(dr\.?|mr\.?|mrs\.?|ms\.?|mx\.?|miss|prof\.?|sir|dame)$/i;

/** First word of the display name for "Hi …", skipping a leading honorific when present (e.g. Dr. Jane Smith → Jane). */
export function firstNameForSalutation(fullName: string): string {
  const t = fullName.trim();
  if (!t) return "[Name]";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "[Name]";
  let i = 0;
  if (SALUTATION_HONORIFIC.test(parts[0] ?? "") && parts.length >= 2) i = 1;
  return parts[i] ?? t;
}

export function buildOutreachLetter(args: {
  letterTemplate: string;
  contactName: string;
  company: string;
  position: string;
  marketLine: string;
  yourName: string;
  yourTitle: string;
  yourEmail: string;
  yourPhone: string;
}): string {
  const tpl = (args.letterTemplate || "").trim() || OUTREACH_LETTER_TEMPLATE;
  const fn = args.position.trim() || "[function/business area]";
  const market = args.marketLine.trim() || "[industry / company / market]";
  const salutationName = firstNameForSalutation(args.contactName);
  let body = tpl.replace(/\[Name\]/g, salutationName);
  body = body.replace(/\[Company\]/g, args.company.trim() || "[Company]");
  body = body.replace(/\[function\/business area\]/g, fn);
  body = body.replace(/\[industry \/ company \/ market\]/g, market);
  body = body.replace(/\[Your Name\]/g, args.yourName.trim() || "[Your Name]");
  body = body.replace(/\[Title \/ Firm, if applicable\]/g, args.yourTitle.trim() || "[Title / Firm, if applicable]");
  body = body.replace(/\[Email\]/g, args.yourEmail.trim() || "[Email]");
  body = body.replace(/\[Phone\]/g, args.yourPhone.trim() || "[Phone]");
  return body;
}

/** Opens a helper window with the message text and a link to the recipient's LinkedIn (paste is manual — LinkedIn blocks remote prefill). */
export function openLinkedInOutreachDraftWindow(
  linkedinUrl: string | null,
  message: string,
  contactName: string
): boolean {
  const w = window.open("", "_blank", "width=620,height=760");
  if (!w) return false;

  w.document.open();
  w.document.write(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>LinkedIn message draft</title>
<style>
  body{font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;padding:18px 20px;background:#0b0e14;color:#e2e8f4;line-height:1.55;font-size:14px;}
  h1{font-size:16px;margin:0 0 14px;font-weight:600;color:#94a3b8;}
  pre{white-space:pre-wrap;word-break:break-word;background:#121920;border:1px solid #253649;border-radius:8px;padding:14px 16px;margin:0 0 18px;font-size:13px;}
  .row{display:flex;flex-wrap:wrap;gap:10px 14px;align-items:center;margin-bottom:14px;}
  button{padding:9px 16px;border-radius:6px;border:1px solid #00d4aa;background:transparent;color:#00d4aa;font-weight:600;cursor:pointer;font-size:13px;}
  button:hover{opacity:0.92;}
  a.profile{color:#60a5fa;font-weight:500;}
  a.profile:hover{text-decoration:underline;}
  .hint{font-size:12px;color:#64748b;margin:0;line-height:1.45;}
  .warn{font-size:12px;color:#f59e0b;margin-top:10px;}
</style></head><body>
<h1 id="hdr"></h1>
<pre id="body"></pre>
<div class="row">
<button type="button" id="copy">Copy message</button>
<a class="profile" id="profile" target="_blank" rel="noopener noreferrer" hidden>Open LinkedIn profile</a>
</div>
<p class="hint">LinkedIn cannot receive message text from external websites. Copy the message, then open the profile (if linked), click <strong>Message</strong>, and paste.</p>
<p class="warn" id="nourl" hidden>No LinkedIn URL was found for this row — open their profile manually.</p>
<script>
(function(){
  var copyBtn = document.getElementById("copy");
  var pre = document.getElementById("body");
  copyBtn.addEventListener("click", function() {
    var t = pre.innerText;
    navigator.clipboard.writeText(t).then(function() {
      copyBtn.textContent = "Copied!";
      setTimeout(function(){ copyBtn.textContent = "Copy message"; }, 2200);
    }, function(){ copyBtn.textContent = "Copy failed"; });
  });
})();
</script>
</body></html>`);
  w.document.close();

  const hdr = w.document.getElementById("hdr");
  const pre = w.document.getElementById("body");
  const profile = w.document.getElementById("profile") as HTMLAnchorElement | null;
  const nourl = w.document.getElementById("nourl");
  if (hdr) hdr.textContent = "Message draft — " + contactName;
  if (pre) pre.textContent = message;
  if (profile && linkedinUrl) {
    profile.href = linkedinUrl;
    profile.textContent = "Open LinkedIn profile";
    profile.hidden = false;
  } else if (nourl && !linkedinUrl) {
    nourl.hidden = false;
  }

  return true;
}
