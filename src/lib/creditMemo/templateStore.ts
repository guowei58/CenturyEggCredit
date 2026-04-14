import { createHash } from "crypto";

import { buildCreditMemoTemplateFromDocxBytes } from "./creditMemoTemplateDocx";
import type { CreditMemoTemplate, CreditMemoTemplateIndex } from "./types";
import { WORKSPACE_GLOBAL_TICKER } from "@/lib/user-ticker-workspace-constants";
import {
  loadPublicDefaultCreditMemoTemplate,
  PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID,
  readPublicDefaultCreditMemoDocxBuffer,
} from "./publicDefaultCreditMemoTemplate";
import {
  workspaceDeleteFile,
  workspaceReadFile,
  workspaceReadUtf8,
  workspaceWriteFile,
  workspaceWriteUtf8,
} from "@/lib/user-ticker-workspace-store";

export { extractSectionHintsFromHtml } from "./creditMemoTemplateDocx";

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

function normalizeIndexWithPublic(idx: CreditMemoTemplateIndex, pub: CreditMemoTemplate | null): CreditMemoTemplateIndex {
  const templates = pub
    ? [pub, ...idx.templates.filter((t) => t.id !== PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID)]
    : [...idx.templates];

  let activeTemplateId = idx.activeTemplateId;
  if (activeTemplateId && activeTemplateId !== PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID) {
    if (!idx.templates.some((t) => t.id === activeTemplateId)) {
      activeTemplateId = pub ? PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID : null;
    }
  }
  if (activeTemplateId === null && idx.templates.length === 0 && pub) {
    activeTemplateId = PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID;
  }

  return { activeTemplateId, templates };
}

export async function listCreditMemoTemplates(userId: string): Promise<CreditMemoTemplateIndex> {
  const idx = await readIndex(userId);
  const pub = await loadPublicDefaultCreditMemoTemplate();
  return normalizeIndexWithPublic(idx, pub);
}

/** Raw .docx bytes for a template (user-owned or shared default). */
export async function readCreditMemoTemplateDocx(userId: string, templateId: string): Promise<Buffer | null> {
  const id = templateId.trim();
  if (!id) return null;
  if (id === PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID) {
    const buf = readPublicDefaultCreditMemoDocxBuffer();
    return buf?.length ? buf : null;
  }
  const idx = await readIndex(userId);
  if (!idx.templates.some((t) => t.id === id)) return null;
  return workspaceReadFile(userId, WORKSPACE_GLOBAL_TICKER, docxPath(id));
}

export async function getActiveCreditMemoTemplate(userId: string): Promise<CreditMemoTemplate | null> {
  const idx = await readIndex(userId);
  const pub = await loadPublicDefaultCreditMemoTemplate();

  if (idx.activeTemplateId === PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID) {
    return pub;
  }
  if (idx.activeTemplateId) {
    const t = idx.templates.find((x) => x.id === idx.activeTemplateId);
    if (t) return t;
  }
  if (pub && idx.templates.length === 0) {
    return pub;
  }
  return null;
}

export async function saveCreditMemoTemplateDocx(
  userId: string,
  params: {
    filename: string;
    bytes: Uint8Array;
  }
): Promise<CreditMemoTemplate> {
  const tpl = await buildCreditMemoTemplateFromDocxBytes({
    buffer: Buffer.from(params.bytes),
    id: stableId(["cm_tpl", params.filename, String(params.bytes.length), nowIso()]),
    filename: params.filename,
    uploadedAt: nowIso(),
  });

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
  const id = templateId.trim();
  const idx = await readIndex(userId);
  const pub = await loadPublicDefaultCreditMemoTemplate();

  if (id === PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID) {
    if (!pub) return normalizeIndexWithPublic(idx, pub);
    const next = { ...idx, activeTemplateId: PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID };
    await writeIndex(userId, next);
    return normalizeIndexWithPublic(next, pub);
  }

  if (!idx.templates.some((t) => t.id === id)) {
    return normalizeIndexWithPublic(idx, pub);
  }
  const next = { ...idx, activeTemplateId: id };
  await writeIndex(userId, next);
  return normalizeIndexWithPublic(next, pub);
}

export async function deleteCreditMemoTemplate(
  userId: string,
  templateId: string
): Promise<CreditMemoTemplateIndex> {
  const id = templateId.trim();
  if (id === PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID) {
    throw new Error("Cannot delete the shared default template");
  }

  const idx = await readIndex(userId);
  const pub = await loadPublicDefaultCreditMemoTemplate();
  const nextTemplates = idx.templates.filter((t) => t.id !== id);
  const nextActive =
    idx.activeTemplateId === id
      ? (nextTemplates[0]?.id ?? (pub ? PUBLIC_DEFAULT_CREDIT_MEMO_TEMPLATE_ID : null))
      : idx.activeTemplateId;

  await workspaceDeleteFile(userId, WORKSPACE_GLOBAL_TICKER, docxPath(id));

  const next: CreditMemoTemplateIndex = { activeTemplateId: nextActive, templates: nextTemplates };
  await writeIndex(userId, next);
  return normalizeIndexWithPublic(next, pub);
}
