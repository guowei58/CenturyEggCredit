/**
 * Capital Structure and Org Chart tab-prompt API runs expect a base64 .xlsx in the model reply.
 */

export const EXCEL_API_RESEARCH_SAVE_KEYS = new Set<string>(["capital-structure", "org-chart-prompt"]);

export function isExcelApiDeliverableSaveKey(saveKey?: string | null): boolean {
  const key = saveKey?.trim() ?? "";
  return key.length > 0 && EXCEL_API_RESEARCH_SAVE_KEYS.has(key);
}

/** Appended to Capital Structure / Org Chart prompt templates. */
export const EXCEL_API_OUTPUT_FORMAT_SECTION = `
==================================================
OUTPUT FORMAT (REQUIRED — EXCEL FILE ONLY)
==================================================
Return **ONLY** a valid Excel workbook (.xlsx) encoded as base64. Nothing else.

Do **NOT** include:
- markdown tables or prose summaries
- entity lists, short summaries, or diligence flags outside the workbook
- Python / JavaScript code or shell commands
- download links or instructions to run code

Put **all** commentary, notes, sources, assumptions, and source logs **inside the workbook tabs** (e.g. Notes, Sources).

Encode the complete binary .xlsx file as standard base64. Use exactly this format — your entire response must be only this fence:

\`\`\`xlsx
<BASE64_ENCODED_XLSX_BYTES>
\`\`\`

The decoded bytes must be a valid Office Open XML spreadsheet (PK zip header). The application decodes this automatically and displays the workbook in the viewer.
`.trim();

export const EXCEL_API_DELIVERABLE_USER_BLOCK = `
Excel API output (required):
- Your **entire** response must be **only** a base64-encoded .xlsx inside a \`\`\`xlsx fenced block.
- No markdown, prose, code, or download links before or after the fence.
- All notes and sources belong inside workbook tabs, not in the chat response.
`.trim();

export const EXCEL_API_DELIVERABLE_SYSTEM = `You are an Excel workbook builder for leveraged-finance and credit analysis.

The user message specifies workbook structure and content. Follow it precisely when building the spreadsheet.

Your response must contain ONLY a base64-encoded .xlsx file inside a \`\`\`xlsx code fence. Do not use Markdown, bullet lists, or narrative text in the chat response. Do not return Python or other code instead of the file.

If you cannot produce a valid base64-encoded .xlsx, respond with exactly one line: ERROR: Cannot produce xlsx`;

const EXCEL_OUTPUT_MARKER = "output format (required — excel file only)";

/** Skip research benchmark / markdown output discipline for Excel-deliverable API runs. */
export function withExcelApiPromptNotice(prompt: string): string {
  const trimmed = prompt.trimEnd();
  if (!trimmed) return prompt;
  if (trimmed.toLowerCase().includes(EXCEL_OUTPUT_MARKER)) return prompt;
  return trimmed;
}

export function buildExcelApiTruncatedWarning(): string {
  return (
    "The model hit max output length before finishing the base64 .xlsx. " +
    "The file may be incomplete — try a model with a higher output cap (e.g. Claude Opus, GPT-4.1), or use Copy prompt in an external tool and upload the .xlsx manually."
  );
}
