import type { TickerPromptExportFile } from "@/lib/export-ticker-prompts";

const DOWNLOAD_STAGGER_MS = 120;

function triggerTextFileDownload(relativePath: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = relativePath;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Saves one `.txt` per prompt into the browser's default Downloads folder as
 * `{ticker}-prompts/01-….txt` (Chrome/Edge honor the subfolder in `download`).
 */
export async function downloadPromptExportFilesToDownloads(
  ticker: string,
  files: TickerPromptExportFile[]
): Promise<void> {
  const folderName = `${ticker.trim().toUpperCase()}-prompts`;

  for (let i = 0; i < files.length; i++) {
    triggerTextFileDownload(`${folderName}/${files[i].filename}`, files[i].content);
    if (i < files.length - 1) {
      await sleep(DOWNLOAD_STAGGER_MS);
    }
  }
}
