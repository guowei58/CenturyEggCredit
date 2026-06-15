import { upsertUserSavedDocument } from "@/lib/user-workspace-store";
import { sanitizeTicker } from "@/lib/saved-ticker-data";
import type { PresentationDiscoveryMetadata, ValidatedPresentationCandidate } from "./types";
import { downloadPresentationFile } from "./validate";

export async function savePresentationDiscoveryDocument(
  userId: string,
  ticker: string,
  candidate: ValidatedPresentationCandidate
): Promise<
  | { ok: true; filename: string; openUrl: string; bytes: number }
  | { ok: false; error: string }
> {
  const safeTicker = sanitizeTicker(ticker);
  if (!safeTicker) return { ok: false, error: "Invalid ticker" };

  const buffer = await downloadPresentationFile(candidate.url, candidate.source_page_url);
  if (!buffer) return { ok: false, error: "Could not re-download presentation for storage" };

  const ext = candidate.file_type === "pdf" ? "pdf" : candidate.file_type === "pptx" ? "pptx" : "ppt";
  const periodSlug = candidate.period.replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  const filename = `${safeTicker}-${periodSlug}-mgmt-presentation.${ext}`;
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

  return {
    ok: true,
    filename,
    openUrl: `/api/saved-documents/${encodeURIComponent(safeTicker)}?file=${encodeURIComponent(filename)}`,
    bytes: buffer.length,
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
