import "dotenv/config";
import { prisma } from "../src/lib/prisma";

async function main() {
  const rows = await prisma.userTickerWorkspaceFile.findMany({
    where: { ticker: "GEN", path: { contains: "lme-retrieval-embeddings" } },
    select: { path: true, body: true },
  });
  for (const r of rows) {
    const j = JSON.parse(Buffer.from(r.body).toString("utf8")) as {
      fingerprint?: string;
      embeddingProvider?: string;
      embeddingModel?: string;
      vectors?: Record<string, number[]>;
    };
    console.log(
      r.path,
      "vectors",
      Object.keys(j.vectors ?? {}).length,
      "provider",
      j.embeddingProvider,
      "model",
      j.embeddingModel,
      "fp",
      j.fingerprint?.slice(0, 16)
    );
  }
  await prisma.$disconnect();
}

main();
