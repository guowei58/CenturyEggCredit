import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import { prisma } from "../src/lib/prisma";
import { readSavedContent } from "../src/lib/saved-content-hybrid";
import { MEMO_DECK_BUILT_PROMPT_CACHE_KEY } from "../src/lib/creditMemo/builtPromptCache";

async function main() {
  const row = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN" },
    select: { userId: true },
  });
  const raw = await readSavedContent("GEN", MEMO_DECK_BUILT_PROMPT_CACHE_KEY, row!.userId);
  if (!raw) {
    console.log("No saved memo deck cache");
    return;
  }
  const p = JSON.parse(raw) as {
    sharedContext?: {
      fingerprint?: string;
      evidenceDiagnostics?: Record<string, unknown>;
    };
    byProductKey?: Record<string, { builtAt?: string; builtPrompt?: { retrievalUsed?: boolean } }>;
  };
  console.log("sharedContext fingerprint:", p.sharedContext?.fingerprint);
  console.log("\nevidenceDiagnostics:", JSON.stringify(p.sharedContext?.evidenceDiagnostics, null, 2));
  const memo = p.byProductKey?.memo;
  if (memo) {
    console.log("\nmemo builtAt:", memo.builtAt);
    console.log("memo retrievalUsed:", memo.builtPrompt?.retrievalUsed);
  }
  await prisma.$disconnect();
}

main();
