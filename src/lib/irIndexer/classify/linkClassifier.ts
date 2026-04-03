import type { IrAssetType } from "../types";
import { guessExtension, hostnameOf } from "../utils";

function containsAny(h: string, needles: string[]): boolean {
  return needles.some((n) => h.includes(n));
}

export function classifyLink(params: {
  url: string;
  anchorText?: string | null;
  contextHeading?: string | null;
  contextText?: string | null;
}): { assetType: IrAssetType; extension: string | null } {
  const url = params.url;
  const ext = guessExtension(url);
  const host = hostnameOf(url);

  const a = (params.anchorText ?? "").toLowerCase();
  const h = (params.contextHeading ?? "").toLowerCase();
  const c = (params.contextText ?? "").toLowerCase();
  const blob = `${a} ${h} ${c}`.trim();

  if (ext === "pdf") return { assetType: "pdf", extension: "pdf" };
  if (containsAny(host, ["sec.gov", "www.sec.gov", "data.sec.gov"])) return { assetType: "sec_filing", extension: ext };
  if (containsAny(url.toLowerCase(), ["edgar", "archives/edgar", "ixviewer"])) return { assetType: "sec_filing", extension: ext };
  if (containsAny(blob, ["10-k", "10k", "10-q", "10q", "8-k", "8k", "def 14a", "proxy", "20-f", "6-k", "s-4", "424b"])) {
    return { assetType: "sec_filing", extension: ext };
  }
  if (containsAny(blob, ["press release", "news release", "press-release"])) return { assetType: "press_release", extension: ext };
  if (containsAny(blob, ["presentation", "investor deck", "slides"])) return { assetType: "presentation", extension: ext };
  if (containsAny(blob, ["transcript"])) return { assetType: "transcript", extension: ext };
  if (containsAny(blob, ["webcast", "earnings call", "call replay", "listen live"])) return { assetType: "webcast", extension: ext };
  if (containsAny(blob, ["annual report", "form 10-k"])) return { assetType: "annual_report", extension: ext };
  if (containsAny(blob, ["quarterly", "form 10-q"])) return { assetType: "quarterly_report", extension: ext };
  if (containsAny(blob, ["governance", "board", "committee", "charter", "esg", "code of conduct"])) return { assetType: "governance", extension: ext };
  if (containsAny(blob, ["event", "calendar", "conference", "investor day"])) return { assetType: "event", extension: ext };

  return { assetType: "html_page", extension: ext };
}

