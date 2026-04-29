import type { ExtractedPublicRecordSuggestions } from "./extractPublicRecordDocumentTypes";

export type { ExtractedPublicRecordSuggestions } from "./extractPublicRecordDocumentTypes";

/** Extract plain text from PDF buffer and apply lightweight regex heuristics — user must confirm before save. */
export async function extractPublicRecordFieldsFromPdf(buffer: Buffer): Promise<{
  rawText: string;
  suggestions: ExtractedPublicRecordSuggestions;
}> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  let rawText = "";
  try {
    const tr = await parser.getText({ first: 50 });
    rawText = (tr.text ?? "").replace(/\s+/g, " ").trim();
  } finally {
    await parser.destroy().catch(() => undefined);
  }

  const suggestions: ExtractedPublicRecordSuggestions = {};

  const amt = rawText.match(/\$\s*[\d,]+(?:\.\d{2})?/);
  if (amt) suggestions.amount = amt[0]!.replace(/\s/g, "");

  const iso = rawText.match(/\b(20\d{2}|19\d{2})-\d{2}-\d{2}\b/);
  if (iso) suggestions.filingDate = iso[0];

  const caseLike = rawText.match(/\b(?:Case|Cause)\s*[#:]?\s*([A-Z0-9-]{4,})\b/i);
  if (caseLike) suggestions.caseNumber = caseLike[1];

  const parcel = rawText.match(/\b(?:Parcel|Geo ID|Property ID)\s*[#:]?\s*([A-Z0-9-]{3,})\b/i);
  if (parcel) suggestions.parcelNumber = parcel[1];

  const lien = /Notice of Federal Tax Lien|NFTL|UCC-1|Financing Statement|Judgment|Mechanic'?s Lien/i.exec(rawText);
  if (lien) suggestions.recordType = lien[0]!;

  const lines = rawText.split(/(?<=[.!?])\s+/).slice(0, 3);
  if (lines.length) suggestions.summary = lines.join(" ").slice(0, 500);

  return { rawText, suggestions };
}
