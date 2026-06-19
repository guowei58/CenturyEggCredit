import { buildDistressedPromptForUrl } from "@/lib/credit-doc-review-prompt-url";
import { downloadAndExtractSecDocument } from "@/lib/debt-map/documentFetch";

const MIN_INLINED_DOC_CHARS = 200;

/** Build distressed doc-review user prompt — inlines SEC text when fetch succeeds. */
export async function buildCreditDocReviewUserPrompt(
  basePromptWithBackground: string,
  url: string
): Promise<{ prompt: string; documentInlined: boolean; fetchError?: string }> {
  const fetched = await downloadAndExtractSecDocument(url.trim());
  const body = fetched.text.trim();

  if (fetched.ok && body.length >= MIN_INLINED_DOC_CHARS) {
    return {
      prompt: `${basePromptWithBackground.trim()}\n\n---\nSOURCE DOCUMENT TEXT (retrieved from ${url.trim()} — base your entire analysis on this text):\n\n${body}\n`,
      documentInlined: true,
    };
  }

  const fetchError = fetched.error?.trim() || (body.length > 0 ? "extracted text too short" : "empty document");
  return {
    prompt: buildDistressedPromptForUrl(basePromptWithBackground, url),
    documentInlined: false,
    fetchError,
  };
}
