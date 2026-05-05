import type { CreditDocWorkflowEntityRole } from "@/generated/prisma/client";
import type { CreditDocExtractionMethod } from "@/generated/prisma/client";
import { classifyRoleFromSignatureContext } from "./classifyCreditDocEntityRoles";

export type ExtractedDraft = {
  entityName: string;
  rawContext: string;
  entityRole: CreditDocWorkflowEntityRole;
  sourceSection?: string | null;
  sourceSchedule?: string | null;
  excerpt: string;
  extractionMethod: CreditDocExtractionMethod;
};

/** Deterministic extracts: `Name, as Role` signature lines & simple schedule bullets. */
export function extractCreditDocEntities(text: string, documentTitle: string): ExtractedDraft[] {
  void documentTitle;
  const out: ExtractedDraft[] = [];
  const lines = text.split(/\r?\n/);
  let scheduleHeading: string | null = null;
  const entityLike = /^[A-Za-z0-9][A-Za-z0-9 &,.'()-]{2,240}$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^schedule\s+[ivx\d]+[:.\s-]/i.test(line)) {
      scheduleHeading = line.slice(0, 180);
      continue;
    }
    const mr = line.match(/^(.{3,240}?),\s*as\s+(.+)$/i);
    if (mr) {
      const nameRaw = mr[1]!.replace(/^["'\s]+|["'\s]+$/g, "").trim();
      const roleTail = mr[2]!.replace(/[.:;]+$/, "").trim();
      const { role } = classifyRoleFromSignatureContext(`as ${roleTail}`);
      if (nameRaw.length >= 3 && role !== "unknown") {
        out.push({
          entityName: nameRaw,
          rawContext: line,
          entityRole: role,
          sourceSection: "signature_pages",
          sourceSchedule: scheduleHeading,
          excerpt: line.slice(0, 520),
          extractionMethod: "signature_page_extraction",
        });
      }
      continue;
    }
    if (scheduleHeading && /^(\d+[.)]\s+|[-•])\s*.+$/i.test(line)) {
      const cleaned = line.replace(/^\d+[.)]\s+|^[-•]\s+/, "").trim();
      const rawCell = cleaned.includes("\t") ? cleaned.split("\t")[0]! : cleaned.split(",")[0]!;
      const trimmed = rawCell.replace(/\*{0,3}/g, "").trim();
      if (entityLike.test(trimmed) && !/@/.test(trimmed)) {
        out.push({
          entityName: trimmed,
          rawContext: line,
          entityRole: "subsidiary",
          sourceSchedule: scheduleHeading,
          excerpt: cleaned.slice(0, 520),
          extractionMethod: "schedule_extraction",
        });
      }
    }
  }
  const k = new Set<string>();
  return out.filter((r) => {
    const kk = `${r.entityName}|${r.entityRole}`.toLowerCase();
    if (k.has(kk)) return false;
    k.add(kk);
    return true;
  });
}
