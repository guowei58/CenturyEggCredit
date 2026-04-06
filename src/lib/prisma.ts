import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
  pgPool: Pool | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  const pool = globalForPrisma.pgPool ?? new Pool({ connectionString });
  globalForPrisma.pgPool = pool;
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/**
 * Reuse one client per process, but drop a stale singleton after `prisma generate`
 * adds models. Otherwise `globalThis.prisma` can hold a pre-regeneration client whose
 * delegates (e.g. `conversationMember`) are missing → undefined.findMany at runtime.
 */
function getPrisma(): PrismaClient {
  const existing = globalForPrisma.prisma;
  if (
    existing &&
    typeof existing.conversationMember?.findMany === "function" &&
    typeof existing.eggHocMessage?.findMany === "function"
  ) {
    return existing;
  }
  const client = createPrismaClient();
  globalForPrisma.prisma = client;
  return client;
}

export const prisma = getPrisma();
