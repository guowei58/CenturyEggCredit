import fs from "node:fs";
import path from "node:path";

const componentsDir = path.join(process.cwd(), "src", "components");

const SKIP = new Set([
  "CompanyOverviewTab.tsx",
  "CompanyCapitalStructureTab.tsx",
  "CompanyOrgChartTab.tsx",
  "CompanyCreditAgreementsIndenturesTab.tsx",
  "CompanyEmployeeContactsTab.tsx",
  "CompanySubsidiaryListTab.tsx",
  "CompanyAiCreditDeckTab.tsx",
  "HistoricalFinancialsAiWorkflow.tsx",
  "DistressedLinkAnalyzeModal.tsx",
]);

const OPEN_RE =
  /      <div className="flex flex-col gap-6 lg:flex-row">\r?\n(?:        \{\/\*[\s\S]*?\*\/\}\r?\n)?        <SavedResponseExpandableShell/;
const MID_RE =
  /        <\/SavedResponseExpandableShell>\r?\n(?:\r?\n)?(?:        \{\/\*[\s\S]*?\*\/\}\r?\n)?        <div className="flex w-full flex-col lg:w-80 flex-shrink-0">/;
const CLOSE_RE = /        <\/div>\r?\n      <\/div>\r?\n    <\/Card>/;

function patchFile(filePath) {
  const name = path.basename(filePath);
  if (SKIP.has(name)) return { name, status: "skipped" };

  let content = fs.readFileSync(filePath, "utf8");
  if (!content.includes("lg:w-80 flex-shrink-0")) return { name, status: "no-match" };
  if (content.includes("TabPromptSlideOutShell")) return { name, status: "already" };

  if (!OPEN_RE.test(content) || !MID_RE.test(content) || !CLOSE_RE.test(content)) {
    return { name, status: "pattern-mismatch" };
  }

  if (!content.includes("import { TabPromptSlideOutShell }")) {
    content = content.replace(
      /import \{ PromptTemplateBox \} from "@\/components\/PromptTemplateBox";/,
      'import { PromptTemplateBox } from "@/components/PromptTemplateBox";\nimport { TabPromptSlideOutShell } from "@/components/TabPromptSlideOutShell";'
    );
  }

  content = content.replace(
    OPEN_RE,
    "      <TabPromptSlideOutShell\n        hasMainContent={savedContent.trim().length > 0}\n        main={\n          <SavedResponseExpandableShell"
  );

  content = content.replace(
    MID_RE,
    "        </SavedResponseExpandableShell>\n        }\n        prompt={\n          <>"
  );

  content = content.replace(CLOSE_RE, "          </>\n        }\n      />\n    </Card>");

  fs.writeFileSync(filePath, content);
  return { name, status: "patched" };
}

const files = fs
  .readdirSync(componentsDir)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => path.join(componentsDir, f));

const results = files.map(patchFile);
for (const r of results.filter((x) => x.status !== "no-match")) {
  console.log(`${r.name}: ${r.status}`);
}
