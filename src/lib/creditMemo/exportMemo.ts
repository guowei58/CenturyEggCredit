import type { MemoJob } from "./types";
import { memoMarkdownToDocxBuffer } from "./docxExport";

export function memoToHtml(markdown: string, title: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const lines = markdown.split("\n");
  const body: string[] = [];
  let inUl = false;

  const closeUl = () => {
    if (inUl) {
      body.push("</ul>");
      inUl = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith("## ")) {
      closeUl();
      body.push(`<h2>${esc(line.slice(3))}</h2>`);
      continue;
    }
    if (line.startsWith("### ")) {
      closeUl();
      body.push(`<h3>${esc(line.slice(4))}</h3>`);
      continue;
    }
    if (line.startsWith("# ")) {
      closeUl();
      body.push(`<h1>${esc(line.slice(2))}</h1>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      if (!inUl) {
        body.push("<ul>");
        inUl = true;
      }
      body.push(`<li>${esc(line.replace(/^[-*]\s+/, ""))}</li>`);
      continue;
    }
    closeUl();
    if (line.trim() === "") {
      body.push("<br/>");
    } else {
      body.push(`<p>${esc(line)}</p>`);
    }
  }
  closeUl();

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
body{font-family:Georgia,serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#111;line-height:1.45;}
h1{font-size:1.6rem;border-bottom:1px solid #ccc;padding-bottom:0.3rem;}
h2{font-size:1.25rem;margin-top:1.5rem;}
h3{font-size:1.05rem;}
code, pre{font-family:ui-monospace,monospace;background:#f5f5f5;}
</style></head><body>
<h1>${esc(title)}</h1>
${body.join("\n")}
</body></html>`;
}

export function downloadFilename(job: MemoJob, ext: string): string {
  const safe = job.ticker.replace(/[^a-z0-9-_]/gi, "_");
  return `credit-memo_${safe}_${job.id.slice(0, 8)}.${ext}`;
}

/** Filename for exports built from arbitrary on-screen markdown (not tied to a stored job). */
export function downloadFilenameForTickerBody(ticker: string, ext: string): string {
  const safe = (ticker || "memo").replace(/[^a-z0-9-_]/gi, "_");
  const stamp = Date.now().toString(36).slice(-8);
  return `credit-memo_${safe}_${stamp}.${ext}`;
}

export async function memoToDocx(markdown: string, title: string): Promise<Buffer> {
  return memoMarkdownToDocxBuffer(markdown, title);
}
