import path from "path";
import type { SourceCategory } from "./types";

const DEBT = /(indenture|credit[\s-]*agreement|cred(it)?[\s-]*facilit|loan|bond|notes?\s+purchase|intercreditor|guarantee)/i;
const SEC = /(10[\s-]?k|10[\s-]?q|8[\s-]?k|s-4|424b|prospectus|def\s*14a|20-f)/i;
const TRANSCRIPT = /(transcript|earnings\s*call)/i;
const PRES = /(investor|presentation|deck|roadshow)/i;
const RATING = /(moody|s&p|fitch|rating)/i;
const PRESS = /(press\s*release|news\s*release)/i;
const NEWS = /news|article|wsj|reuters|ft\.com/i;
const ORG = /(exhibit\s*21|subsidiar|org\s*chart|organizational)/i;

export function classifySourceFilename(relPath: string): SourceCategory {
  const base = path.basename(relPath);
  const joint = `${relPath} ${base}`;

  if (DEBT.test(joint)) return "debt_document";
  if (SEC.test(joint)) return "sec_filing";
  if (TRANSCRIPT.test(joint)) return "transcript";
  if (PRES.test(joint)) return "presentation";
  if (RATING.test(joint)) return "rating_agency";
  if (ORG.test(joint)) return "org_legal";
  if (PRESS.test(joint)) return "press_release";
  if (NEWS.test(joint)) return "news";

  const ext = path.extname(relPath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls" || ext === ".xlsm" || ext === ".csv") {
    if (/model|lbo|dcf|projection|forecast|scenario/i.test(joint)) return "model_spreadsheet";
    return "model_spreadsheet";
  }

  if (/notes|research|memo|scratch/i.test(joint)) return "notes";

  return "other";
}

/** Higher priority = earlier in evidence pack when trimming. */
export function categoryPriority(c: SourceCategory): number {
  switch (c) {
    case "debt_document":
      return 100;
    case "sec_filing":
      return 95;
    case "model_spreadsheet":
      return 88;
    case "transcript":
      return 82;
    case "presentation":
      return 80;
    case "rating_agency":
      return 78;
    case "org_legal":
      return 70;
    case "press_release":
      return 65;
    case "news":
      return 55;
    case "notes":
      return 60;
    case "ai_chat":
      return 58;
    default:
      return 50;
  }
}
