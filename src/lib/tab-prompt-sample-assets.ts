/**
 * Load whitelisted /public sample images for tab-prompt API (Capital Structure / Org Chart).
 */

import fs from "fs/promises";
import path from "path";
import { CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS } from "@/data/capital-structure-prompt";
import { ORG_CHART_SAMPLE_IMAGE_PATHS } from "@/data/org-chart-prompt";
import type { ChatUserContentPart } from "@/lib/chat-multimodal-types";

const ALLOWED = new Set<string>([...CAPITAL_STRUCTURE_SAMPLE_IMAGE_PATHS, ...ORG_CHART_SAMPLE_IMAGE_PATHS]);

const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

export function filterAllowedSamplePublicPaths(requested: unknown): string[] {
  if (!Array.isArray(requested)) return [];
  const out: string[] = [];
  for (const x of requested) {
    if (typeof x !== "string") continue;
    const p = x.trim();
    if (ALLOWED.has(p)) out.push(p);
  }
  return out;
}

export async function loadPublicSampleImagesAsParts(paths: string[]): Promise<
  { ok: true; parts: ChatUserContentPart[] } | { ok: false; error: string }
> {
  const root = path.resolve(process.cwd(), "public");
  let total = 0;
  const parts: ChatUserContentPart[] = [];
  for (const webPath of paths) {
    const rel = webPath.replace(/^\/+/, "");
    const abs = path.resolve(root, rel);
    if (!abs.startsWith(root + path.sep)) {
      return { ok: false, error: "Invalid sample path" };
    }
    let buf: Buffer;
    try {
      buf = await fs.readFile(abs);
    } catch {
      return { ok: false, error: `Missing sample file: ${webPath}` };
    }
    total += buf.length;
    if (total > MAX_TOTAL_BYTES) {
      return { ok: false, error: "Sample images exceed size limit." };
    }
    const ext = path.extname(abs).toLowerCase();
    const media =
      ext === ".png"
        ? "image/png"
        : ext === ".jpg" || ext === ".jpeg"
          ? "image/jpeg"
          : null;
    if (!media) {
      return { ok: false, error: `Unsupported image type: ${webPath}` };
    }
    parts.push({
      type: "image",
      source: { type: "base64", media_type: media, data: buf.toString("base64") },
    });
  }
  return { ok: true, parts };
}
