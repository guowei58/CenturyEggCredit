/**
 * One-off helper: add Meta AI open button + imports to tab components that match the Claude/ChatGPT pattern.
 * Run: node scripts/patch-meta-ai-buttons.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

const FILES = [
  "src/components/CompanyIndustryContactsTab.tsx",
  "src/components/CompanyEmployeeContactsTab.tsx",
  "src/components/CompanyResearchRoadmapTab.tsx",
  "src/components/CompanyOutOfTheBoxIdeasTab.tsx",
  "src/components/CompanyManagementBoardTab.tsx",
  "src/components/CompanyHistoryTab.tsx",
  "src/components/CompanyCreditTimelineTab.tsx",
  "src/components/CompanyCompetitorsTab.tsx",
  "src/components/CompanyStartupRisksTab.tsx",
  "src/components/CompanyPortersFiveForcesTab.tsx",
];

const importOld = `import {
  CHATGPT_LONG_URL_NOTICE,
  chatGptOpenStatusMessage,
  openChatGptNewChatWindow,
} from "@/lib/chatgpt-open-url";`;

const importNew = `import { chatGptOpenStatusMessage, openChatGptNewChatWindow } from "@/lib/chatgpt-open-url";
import { CHATGPT_AND_META_LONG_URL_NOTICES, openMetaAiWithClipboard } from "@/lib/meta-ai-open-url";`;

const afterChatGpt = `    } catch {
      setClipboardFailed(true);
      setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
    }
  }

  if (!safeTicker) {`;

const afterChatGptNew = `    } catch {
      setClipboardFailed(true);
      setStatusMessage(chatGptOpenStatusMessage(wasShortened, true));
    }
  }

  function openInMetaAI() {
    if (!prompt) return;
    openMetaAiWithClipboard(prompt, setStatusMessage, setClipboardFailed);
  }

  if (!safeTicker) {`;

const noticeOld = `            Open in Claude or ChatGPT; prompt is copied to clipboard. {CHATGPT_LONG_URL_NOTICE}`;
const noticeNew = `            Open in Claude, ChatGPT, or Meta AI; prompt is copied to clipboard. {CHATGPT_AND_META_LONG_URL_NOTICES}`;

const btnOld = `            <button
              type="button"
              onClick={openInChatGPT}
              className="rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
            >
              Open in ChatGPT
            </button>
            <button
              type="button"
              onClick={copyToClipboard}`;

const btnNew = `            <button
              type="button"
              onClick={openInChatGPT}
              className="rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "transparent" }}
            >
              Open in ChatGPT
            </button>
            <button
              type="button"
              onClick={openInMetaAI}
              className="rounded border px-3 py-1.5 text-xs font-medium"
              style={{ borderColor: "#0866FF", color: "#0866FF", background: "transparent" }}
            >
              Open in Meta AI
            </button>
            <button
              type="button"
              onClick={copyToClipboard}`;

for (const rel of FILES) {
  const fp = path.join(root, rel);
  let s = fs.readFileSync(fp, "utf8");
  if (s.includes("openMetaAiWithClipboard")) {
    console.log("skip (already patched):", rel);
    continue;
  }
  if (!s.includes(importOld)) {
    console.error("missing import block:", rel);
    process.exitCode = 1;
    continue;
  }
  s = s.replace(importOld, importNew);
  if (!s.includes(afterChatGpt)) {
    console.error("missing afterChatGpt:", rel);
    process.exitCode = 1;
    continue;
  }
  s = s.replace(afterChatGpt, afterChatGptNew);
  s = s.replace(
    "Select a company to open this prompt in Claude or ChatGPT.",
    "Select a company to open this prompt in Claude, ChatGPT, or Meta AI."
  );
  s = s.replace(
    'placeholder="Paste your Claude or ChatGPT response here, then click Save."',
    'placeholder="Paste your Claude, ChatGPT, or Meta AI response here, then click Save."'
  );
  s = s.replace(noticeOld, noticeNew);
  if (!s.includes(btnOld)) {
    console.error("missing button block:", rel);
    process.exitCode = 1;
    continue;
  }
  s = s.replace(btnOld, btnNew);
  fs.writeFileSync(fp, s);
  console.log("patched:", rel);
}
