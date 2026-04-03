import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dir = path.join(__dirname, "..", "src", "components");

const files = [
  "BusinessModelTab.tsx",
  "CompanyCreditTimelineTab.tsx",
  "CompanyCompetitorsTab.tsx",
  "CompanyEmployeeContactsTab.tsx",
  "CompanyHistoryTab.tsx",
  "CompanyIndustryContactsTab.tsx",
  "CompanyManagementBoardTab.tsx",
  "CompanyOutOfTheBoxIdeasTab.tsx",
  "CompanyPortersFiveForcesTab.tsx",
  "CompanyResearchRoadmapTab.tsx",
  "CompanyRiskFrom10kTab.tsx",
  "CompanyStartupRisksTab.tsx",
];

const old = `            </button>
          </div>
          {statusMessage && (
            <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
              {statusMessage}
            </p>
          )}
          {clipboardFailed && prompt && (`;

const neu = `            </button>
          </div>
          <TabPromptApiButtons
            userPrompt={prompt}
            onResult={(text) => {
              setEditDraft(text);
              setIsEditing(true);
              setStatusMessage("Response from API — review and click Save to store.");
              setClipboardFailed(false);
            }}
            className="mt-3 border-t border-[var(--border2)] pt-3"
          />
          {statusMessage && (
            <p className="text-xs mb-1" style={{ color: "var(--muted2)" }}>
              {statusMessage}
            </p>
          )}
          {clipboardFailed && prompt && (`;

const imp = `import { RichPasteTextarea } from "@/components/RichPasteTextarea";`;
const imp2 = `${imp}\nimport { TabPromptApiButtons } from "@/components/TabPromptApiButtons";`;

for (const f of files) {
  const p = path.join(dir, f);
  let s = fs.readFileSync(p, "utf8");
  if (s.includes("TabPromptApiButtons")) {
    console.log("skip", f);
    continue;
  }
  if (!s.includes(old)) {
    console.log("NO MATCH", f);
    continue;
  }
  s = s.replace(old, neu);
  if (!s.includes("TabPromptApiButtons")) {
    console.log("FAIL", f);
    continue;
  }
  if (!s.includes(imp2)) s = s.replace(imp, imp2);
  fs.writeFileSync(p, s);
  console.log("ok", f);
}
