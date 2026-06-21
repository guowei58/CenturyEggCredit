import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { getUserPreferences } from "../src/lib/user-preferences-store";
import { buildLlmApiKeyBundle } from "../src/lib/user-llm-keys";
import { emailUsesHostedLlmKeys } from "../src/lib/hosted-llm-accounts";

async function main() {
  const d = await prisma.userSavedDocument.findFirst({
    where: { ticker: "GEN", filename: { contains: "a7116" } },
    select: { userId: true },
  });
  const user = await prisma.user.findUnique({ where: { id: d!.userId }, select: { email: true } });
  const p = await getUserPreferences(d!.userId);
  const k = p.userLlmApiKeys ?? {};
  console.log("email", user?.email);
  console.log("hosted", emailUsesHostedLlmKeys(user?.email));
  console.log("hasOpenAI pref", Boolean(k.openaiApiKey?.trim()));
  console.log("hasGemini pref", Boolean(k.geminiApiKey?.trim()));
  console.log("hasDeepSeek pref", Boolean(k.deepseekApiKey?.trim()));
  const bundle = buildLlmApiKeyBundle(user?.email, p);
  console.log("bundle openai", Boolean(bundle.openaiApiKey?.trim()));
  console.log("bundle gemini", Boolean(bundle.geminiApiKey?.trim()));
  console.log("bundle deepseek", Boolean(bundle.deepseekApiKey?.trim()));
  await prisma.$disconnect();
}

main();
