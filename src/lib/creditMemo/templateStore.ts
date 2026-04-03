import { createHash } from "crypto";
import mammoth from "mammoth";

import type { CreditMemoTemplate, CreditMemoTemplateIndex } from "./types";
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import {
  workspaceDeleteFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

const INDEX_PATH = "credit-memo/templates/index.json";

function docxPath(id: string): string {
  return `credit-memo/templates/${id}.docx`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function stableId(parts: string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 18);
}

function stripHtmlTags(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseHeadingTags(html: string): Array<{ level: 1 | 2 | 3; title: string }> {
  const out: Array<{ level: 1 | 2 | 3; title: string }> = [];
  const re = /<(h[1-3])[^>]*>([\s\S]*?)<\/\1>/gi;
  for (const m of Array.from(html.matchAll(re))) {
    const tag = (m[1] || "").toLowerCase();
    const raw = m[2] || "";
    const title = stripHtmlTags(raw);
    if (!title) continue;
    const level = tag === "h1" ? 1 : tag === "h2" ? 2 : 3;
    out.push({ level, title: title.slice(0, 140) });
  }
  return out;
}

function buildOutlineTitles(headings: Array<{ level: 1 | 2 | 3; title: string }>): string[] {
  const titles = headings
    .filter((h) => h.title.trim().length >= 3)
    .map((h) => h.title.replace(/\s+/g, " ").trim());
  const out: string[] = [];
  for (const t of titles) {
    if (!out.length || out[out.length - 1]!.toLowerCase() !== t.toLowerCase()) out.push(t);
  }
  return out;
}

function emptyIndex(): CreditMemoTemplateIndex {
  return { activeTemplateId: null, templates: [] };
}

async function readIndex(userId: string): Promise<CreditMemoTemplateIndex> {
  const raw = await workspaceReadUtf8(userId, WORKSPACE_GLOBAL_TICKER, INDEX_PATH);
  if (!raw?.trim()) return emptyIndex();
  try {
    const parsed = JSON.parse(raw) as CreditMemoTemplateIndex;
    if (!parsed || !Array.isArray(parsed.templates)) return emptyIndex();
    return {
      activeTemplateId: typeof parsed.activeTemplateId === "string" ? parsed.activeTemplateId : null,
      templates: parsed.templates,
    };
  } catch {
    return emptyIndex();
  }
}

async function writeIndex(userId: string, idx: CreditMemoTemplateIndex): Promise<void> {
  const w = await workspaceWriteUtf8(userId, WORKSPACE_GLOBAL_TICKER, INDEX_PATH, JSON.stringify(idx, null, 2));
  if (!w.ok) throw new Error(w.error);
}

export async function listCreditMemoTemplates(userId: string): Promise<CreditMemoTemplateIndex> {
  return readIndex(userId);
}

export async function getActiveCreditMemoTemplate(userId: string): Promise<CreditMemoTemplate | null> {
  const idx = await readIndex(userId);
  const id = idx.activeTemplateId;
  if (!id) return null;
  return idx.templates.find((t) => t.id === id) ?? null;
}

export async function saveCreditMemoTemplateDocx(
  userId: string,
  params: {
    filename: string;
    bytes: Uint8Array;
  }
): Promise<CreditMemoTemplate> {
  const htmlRes = await mammoth.convertToHtml({ buffer: Buffer.from(params.bytes) });
  const headings = parseHeadingTags(htmlRes.value || "");
  const outlineTitles = buildOutlineTitles(headings);

  const tpl: CreditMemoTemplate = {
    id: stableId(["cm_tpl", params.filename, String(params.bytes.length), nowIso()]),
    filename: params.filename,
    uploadedAt: nowIso(),
    headings,
    outlineTitles,
  };

  const w = await workspaceWriteFile(userId, WORKSPACE_GLOBAL_TICKER, docxPath(tpl.id), Buffer.from(params.bytes));
  if (!w.ok) throw new Error(w.error);

  const idx = await readIndex(userId);
  const templates = idx.templates.filter((t) => t.id !== tpl.id);
  templates.unshift(tpl);
  const next: CreditMemoTemplateIndex = {
    activeTemplateId: tpl.id,
    templates: templates.slice(0, 25),
  };
  await writeIndex(userId, next);
  return tpl;
}

export async function setActiveCreditMemoTemplate(
  userId: string,
  templateId: string
): Promise<CreditMemoTemplateIndex> {
  const idx = await readIndex(userId);
  if (!idx.templates.some((t) => t.id === templateId)) return idx;
  const next = { ...idx, activeTemplateId: templateId };
  await writeIndex(userId, next);
  return next;
}

export async function deleteCreditMemoTemplate(
  userId: string,
  templateId: string
): Promise<CreditMemoTemplateIndex> {
  const idx = await readIndex(userId);
  const nextTemplates = idx.templates.filter((t) => t.id !== templateId);
  const nextActive = idx.activeTemplateId === templateId ? (nextTemplates[0]?.id ?? null) : idx.activeTemplateId;

  await workspaceDeleteFile(userId, WORKSPACE_GLOBAL_TICKER, docxPath(templateId));

  const next: CreditMemoTemplateIndex = { activeTemplateId: nextActive, templates: nextTemplates };
  await writeIndex(userId, next);
  return next;
}
