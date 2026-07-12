import { companyNav, type CompanyTopSectionId } from "@/data/company-navigation";
import { tabLabelToId } from "@/lib/tabs";
import { extractXlsxArrayBufferFromApiText } from "@/lib/extract-xlsx-from-api-text";
import { initTickerSaveFolder, saveToServer, type SavedDataKey } from "@/lib/saved-data-client";

const IMPORT_SECTIONS: CompanyTopSectionId[] = [
  "overview",
  "industry-competition",
  "capital-structure",
  "research",
];

export type TabResponseImportTarget =
  | { kind: "text"; saveKey: SavedDataKey; tabLabel: string }
  | { kind: "excel"; excelTarget: "capital-structure" | "org-chart"; tabLabel: string };

/** Nav tab label → where the saved response belongs in OREO. */
const TAB_LABEL_TARGETS: Record<string, TabResponseImportTarget> = {
  "Business Overview": { kind: "text", saveKey: "overview", tabLabel: "Business Overview" },
  "Recent Events": { kind: "text", saveKey: "recent-events", tabLabel: "Recent Events" },
  "Management & Board": { kind: "text", saveKey: "management-board", tabLabel: "Management & Board" },
  "Business Model": { kind: "text", saveKey: "business-model", tabLabel: "Business Model" },
  HowStuffWorks: { kind: "text", saveKey: "how-stuff-works", tabLabel: "HowStuffWorks" },
  "Company History": { kind: "text", saveKey: "company-history", tabLabel: "Company History" },
  "Capital Allocation": { kind: "text", saveKey: "capital-allocation", tabLabel: "Capital Allocation" },
  "Credit Timeline": { kind: "text", saveKey: "credit-timeline", tabLabel: "Credit Timeline" },
  "Out-of-the-Box Ideas": { kind: "text", saveKey: "out-of-the-box-ideas", tabLabel: "Out-of-the-Box Ideas" },
  "Risk from 10K": { kind: "text", saveKey: "risk-from-10k", tabLabel: "Risk from 10K" },
  "Business Risk Analysis": { kind: "text", saveKey: "business-risk-analysis", tabLabel: "Business Risk Analysis" },
  "Porter's Five Forces": { kind: "text", saveKey: "porters-five-forces", tabLabel: "Porter's Five Forces" },
  "Industry History and Drivers": {
    kind: "text",
    saveKey: "industry-history-drivers",
    tabLabel: "Industry History and Drivers",
  },
  "Industry Value Chain": { kind: "text", saveKey: "industry-value-chain", tabLabel: "Industry Value Chain" },
  Competitors: { kind: "text", saveKey: "competitors", tabLabel: "Competitors" },
  Customers: { kind: "text", saveKey: "customers", tabLabel: "Customers" },
  Suppliers: { kind: "text", saveKey: "suppliers", tabLabel: "Suppliers" },
  "Startup Risks": { kind: "text", saveKey: "startup-risks", tabLabel: "Startup Risks" },
  "AI Risk": { kind: "text", saveKey: "ai-risk", tabLabel: "AI Risk" },
  "Capital Structure": { kind: "excel", excelTarget: "capital-structure", tabLabel: "Capital Structure" },
  "Org Chart": { kind: "excel", excelTarget: "org-chart", tabLabel: "Org Chart" },
  "Credit Docs List": {
    kind: "text",
    saveKey: "credit-agreements-indentures-other",
    tabLabel: "Credit Docs List",
  },
  "Credit Agreement": {
    kind: "text",
    saveKey: "credit-agreements-indentures-credit-agreement",
    tabLabel: "Credit Agreement",
  },
  "First Lien Notes": {
    kind: "text",
    saveKey: "credit-agreements-indentures-first-lien-indenture",
    tabLabel: "First Lien Notes",
  },
  "2nd Lien Notes": {
    kind: "text",
    saveKey: "credit-agreements-indentures-second-lien-indenture",
    tabLabel: "2nd Lien Notes",
  },
  "Unsecured Notes": {
    kind: "text",
    saveKey: "credit-agreements-indentures-unsecured",
    tabLabel: "Unsecured Notes",
  },
  "Other Credit Documents": {
    kind: "text",
    saveKey: "credit-agreements-indentures-other-credit-documents",
    tabLabel: "Other Credit Documents",
  },
  "Entity Mapper": { kind: "text", saveKey: "subsidiary-list", tabLabel: "Entity Mapper" },
  "Research Roadmap": { kind: "text", saveKey: "research-roadmap", tabLabel: "Research Roadmap" },
  "Company Reputation": { kind: "text", saveKey: "company-reputation", tabLabel: "Company Reputation" },
  "Competitor Earnings ReadThrus": {
    kind: "text",
    saveKey: "competitor-earnings-readthrus",
    tabLabel: "Competitor Earnings ReadThrus",
  },
  "Mgmt Presentations & Transcripts": {
    kind: "text",
    saveKey: "presentations",
    tabLabel: "Mgmt Presentations & Transcripts",
  },
  "Industry Publications": { kind: "text", saveKey: "industry-publications", tabLabel: "Industry Publications" },
  "Industry Contacts": { kind: "text", saveKey: "industry-contacts", tabLabel: "Industry Contacts" },
  "Employee Contacts": { kind: "text", saveKey: "employee-contacts", tabLabel: "Employee Contacts" },
};

function slugifyImportKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\s+&\s+/g, "-and-")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function buildImportLookup(): Map<string, TabResponseImportTarget> {
  const map = new Map<string, TabResponseImportTarget>();

  const register = (key: string, target: TabResponseImportTarget) => {
    const normalized = slugifyImportKey(key);
    if (normalized && !map.has(normalized)) {
      map.set(normalized, target);
    }
  };

  for (const sectionId of IMPORT_SECTIONS) {
    for (const group of companyNav[sectionId].groups) {
      for (const tabLabel of group.tabs) {
        const target = TAB_LABEL_TARGETS[tabLabel];
        if (!target) continue;
        register(tabLabel, target);
        register(tabLabelToId(tabLabel), target);
        register(target.tabLabel, target);
        if (target.kind === "text") {
          register(target.saveKey, target);
        }
      }
    }
  }

  register("second-lien-notes", TAB_LABEL_TARGETS["2nd Lien Notes"]!);
  register("mgmt-presentations-and-transcripts", TAB_LABEL_TARGETS["Mgmt Presentations & Transcripts"]!);

  return map;
}

const IMPORT_LOOKUP = buildImportLookup();

export type ImportResponseFile = {
  filename: string;
  bytes: ArrayBuffer;
  isText: boolean;
  text?: string;
};

export type ImportTickerResponsesResult = {
  saved: Array<{ filename: string; tabLabel: string }>;
  skipped: Array<{ filename: string; reason: string }>;
  failed: Array<{ filename: string; error: string }>;
};

function basename(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

function stripExtension(name: string): string {
  return name.replace(/\.[^.]+$/i, "");
}

function normalizeImportStem(filename: string): string {
  const base = stripExtension(basename(filename));
  return base
    .replace(/^\d+[-_]/, "")
    .replace(/_/g, "-")
    .trim();
}

export function resolveTabResponseImportTarget(filename: string): TabResponseImportTarget | null {
  const stem = normalizeImportStem(filename);
  if (!stem || stem.toLowerCase() === "readme") return null;
  return IMPORT_LOOKUP.get(slugifyImportKey(stem)) ?? null;
}

/** Remove OREO prompt-export header if the uploaded file still includes it. */
export function stripImportedResponseHeader(content: string): string {
  const lines = content.replace(/^\uFEFF/, "").split(/\r?\n/);
  if (!lines[0]?.match(/^Prompt #\d+:/)) return content.trim();

  let blankAfterHeader = -1;
  let sawGenerated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.startsWith("Generated:")) sawGenerated = true;
    if (sawGenerated && line.trim() === "") {
      blankAfterHeader = i;
      break;
    }
  }

  if (blankAfterHeader >= 0) {
    return lines.slice(blankAfterHeader + 1).join("\n").trim();
  }
  return content.trim();
}

async function uploadExcelWorkbook(
  ticker: string,
  excelTarget: "capital-structure" | "org-chart",
  bytes: ArrayBuffer,
  filename: string
): Promise<void> {
  const apiBasePath =
    excelTarget === "capital-structure" ? "/api/capital-structure-excel" : "/api/org-chart-excel";
  const name = filename.toLowerCase().endsWith(".xlsx")
    ? filename
    : `${stripExtension(filename) || excelTarget}.xlsx`;

  const blob = new Blob([bytes], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const form = new FormData();
  form.append("file", blob, name);
  form.append("filename", name);

  const res = await fetch(`${apiBasePath}/${encodeURIComponent(ticker)}`, { method: "POST", body: form });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
  if (!res.ok || body.ok !== true) {
    throw new Error(body.error ?? `Excel upload failed (${res.status})`);
  }
}

async function saveTextResponse(
  ticker: string,
  saveKey: SavedDataKey,
  content: string
): Promise<void> {
  const ok = await saveToServer(ticker, saveKey, content);
  if (!ok) throw new Error("Could not save to server");
}

export async function importTickerResponseFiles(
  ticker: string,
  files: ImportResponseFile[]
): Promise<ImportTickerResponsesResult> {
  const sym = ticker.trim().toUpperCase();
  const result: ImportTickerResponsesResult = { saved: [], skipped: [], failed: [] };
  if (!sym || files.length === 0) return result;

  await initTickerSaveFolder(sym);

  for (const file of files) {
    const target = resolveTabResponseImportTarget(file.filename);
    if (!target) {
      result.skipped.push({
        filename: file.filename,
        reason: "No matching tab (use the tab name as the filename, e.g. Business Overview.txt)",
      });
      continue;
    }

    try {
      if (target.kind === "excel") {
        let bytes = file.bytes;
        if (file.isText && file.text) {
          const embedded = extractXlsxArrayBufferFromApiText(file.text);
          if (embedded) bytes = embedded;
        }
        if (!bytes.byteLength) {
          throw new Error("Expected an .xlsx file or model output with an embedded xlsx block");
        }
        await uploadExcelWorkbook(sym, target.excelTarget, bytes, basename(file.filename));
      } else {
        const raw = file.isText ? (file.text ?? new TextDecoder().decode(file.bytes)) : "";
        const content = stripImportedResponseHeader(raw);
        if (!content.trim()) {
          throw new Error("File is empty after removing export header");
        }
        await saveTextResponse(sym, target.saveKey, content);
      }
      result.saved.push({ filename: file.filename, tabLabel: target.tabLabel });
    } catch (e) {
      result.failed.push({
        filename: file.filename,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return result;
}

export async function readImportFilesFromFileList(fileList: FileList): Promise<ImportResponseFile[]> {
  const out: ImportResponseFile[] = [];

  for (const file of Array.from(fileList)) {
    const lower = file.name.toLowerCase();
    if (lower.endsWith(".zip")) {
      const nested = await readImportFilesFromZip(file);
      out.push(...nested);
      continue;
    }

    const bytes = await file.arrayBuffer();
    const isText =
      lower.endsWith(".txt") ||
      lower.endsWith(".md") ||
      lower.endsWith(".html") ||
      lower.endsWith(".htm") ||
      (!lower.endsWith(".xlsx") && !lower.endsWith(".zip"));

    out.push({
      filename: file.name,
      bytes,
      isText,
      text: isText ? new TextDecoder().decode(bytes) : undefined,
    });
  }

  return out;
}

async function readImportFilesFromZip(zipFile: File): Promise<ImportResponseFile[]> {
  const JSZip = (await import("jszip")).default;
  const zip = await JSZip.loadAsync(await zipFile.arrayBuffer());
  const out: ImportResponseFile[] = [];

  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir) continue;
    const name = basename(path);
    const lower = name.toLowerCase();
    if (!lower.endsWith(".txt") && !lower.endsWith(".md") && !lower.endsWith(".html") && !lower.endsWith(".xlsx")) {
      continue;
    }

    const bytes = await entry.async("arraybuffer");
    const isText = !lower.endsWith(".xlsx");
    out.push({
      filename: name,
      bytes,
      isText,
      text: isText ? new TextDecoder().decode(bytes) : undefined,
    });
  }

  return out;
}
