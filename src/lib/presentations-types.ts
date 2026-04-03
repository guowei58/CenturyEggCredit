/**
 * Types and validation for the Presentations tab (Claude discovery response).
 * Legacy types (PdfLink, PresentationsApiResponse, etc.) remain for the old pipeline in lib/presentations/.
 */

export type PresentationItem = {
  title: string;
  url: string;
  date?: string;
  source?: string;
  confidence?: string;
};

export type PresentationsResponse = {
  ticker: string;
  presentations: PresentationItem[];
};

/**
 * Validate and normalize Claude's JSON output. Returns null if invalid.
 */
export function validatePresentationsResponse(raw: unknown): PresentationsResponse | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const ticker = typeof o.ticker === "string" ? o.ticker.trim() : "";
  if (!ticker) return null;
  const rawList = o.presentations;
  if (rawList !== null && rawList !== undefined && !Array.isArray(rawList)) return null;
  const list = Array.isArray(rawList) ? rawList : [];
  const presentations: PresentationItem[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const url = typeof rec.url === "string" ? rec.url.trim() : "";
    if (!title || !url) continue;
    presentations.push({
      title,
      url,
      date: typeof rec.date === "string" ? rec.date.trim() : undefined,
      source: typeof rec.source === "string" ? rec.source.trim() : undefined,
      confidence: typeof rec.confidence === "string" ? rec.confidence.trim() : undefined,
    });
  }
  return { ticker: ticker.toUpperCase(), presentations };
}

// —— Legacy types (used by lib/presentations/pipeline.ts) ——
export type PdfLink = {
  url: string;
  title: string;
  sourcePage?: string | null;
  date?: string | null;
  classification?: "Likely Presentation" | "Other PDF";
};
export type PresentationsSuccess = {
  ok: true;
  companyName: string;
  ticker: string;
  officialWebsite: string;
  irPage: string | null;
  confidence: string;
  notes: string | null;
  candidateWebsites: string[];
  pdfs: PdfLink[];
  overrideUsed?: boolean;
};
export type PresentationsFallback = {
  ok: false;
  companyName: string;
  ticker: string;
  message: string;
  candidateWebsites: string[];
};
export type PresentationsApiResponse = PresentationsSuccess | PresentationsFallback;
