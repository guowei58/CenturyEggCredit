import { upsertUserSavedDocument } from "@/lib/user-workspace-store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import type { PresentationDiscoveryMetadata, ValidatedPresentationCandidate } from "./types";
import { downloadPresentationFile } from "./validate";

export async function savePresentationDiscoveryDocument(
  userId: string,
  ticker: string,
  candidate: ValidatedPresentationCandidate
): Promise<
  | { ok: true; filename: string; openUrl: string; bytes: number; metaFilename: string }
  | { ok: false; error: string }
> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  const buffer = await downloadPresentationFile(candidate.url, candidate.source_page_url);
  if (!buffer) return { ok: false, error: "Could not re-download presentation for storage" };

  const ext = candidate.file_type === "pdf" ? "pdf" : candidate.file_type === "pptx" ? "pptx" : "ppt";
  const periodSlug = candidate.period.replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  const filename = `${safeTicker}-${periodSlug}-mgmt-presentation.${ext}`;
  const metaFilename = `${safeTicker}-${periodSlug}-mgmt-presentation.meta.json`;
  const savedAtIso = new Date().toISOString();

  const saved = await upsertUserSavedDocument(userId, safeTicker, {
    filename,
    title: `${candidate.company_name} ${candidate.period} — Management Presentation`,
    originalUrl: candidate.url,
    contentType:
      ext === "pdf"
        ? "application/pdf"
        : ext === "pptx"
          ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
          : "application/vnd.ms-powerpoint",
    body: buffer,
    savedAtIso,
    convertedToPdf: false,
  });
  if (!saved.ok) return saved;

  const metaBody = Buffer.from(JSON.stringify(buildMetadataSidecar(candidate, savedAtIso), null, 2), "utf8");
  await upsertUserSavedDocument(userId, safeTicker, {
    filename: metaFilename,
    title: `${candidate.company_name} ${candidate.period} — Presentation metadata`,
    originalUrl: candidate.source_page_url,
    contentType: "application/json",
    body: metaBody,
    savedAtIso,
    convertedToPdf: false,
  });

  return {
    ok: true,
    filename,
    openUrl: `/api/saved-documents/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(filename)}`,
    bytes: buffer.length,
    metaFilename,
  };
}

function buildMetadataSidecar(candidate: ValidatedPresentationCandidate, savedAtIso: string) {
  return {
    savedAtIso,
    ticker: candidate.ticker,
    cik: candidate.cik,
    company_name: candidate.company_name,
    period: candidate.period,
    document_date: candidate.document_date,
    title: candidate.title,
    url: candidate.url,
    source_page_url: candidate.source_page_url,
    source_type: candidate.source_type,
    file_type: candidate.file_type,
    confidence: candidate.confidence,
    review_status: candidate.review_status,
    evidence: candidate.evidence,
    sha256: candidate.sha256,
    page_count: candidate.page_count,
    text_sample: candidate.text_sample,
    validation: candidate.validation,
  };
}

export function buildDiscoveryMetadataJson(
  metadata: PresentationDiscoveryMetadata,
  best: ValidatedPresentationCandidate | null
): Record<string, unknown> {
  return {
    ...metadata,
    best: best
      ? {
          url: best.url,
          source_type: best.source_type,
          confidence: best.confidence,
          review_status: best.review_status,
          sha256: best.sha256,
        }
      : null,
  };
}
